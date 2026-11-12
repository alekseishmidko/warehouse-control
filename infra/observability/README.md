# Локальная наблюдаемость WMS-402

Отдельный monitoring project: Prometheus, Grafana, Loki, Tempo, Alloy, Alertmanager
и HTTP receiver. Application overlay включает только сеть, OTLP, scrape и Docker
rotation. PostgreSQL/приложение не устанавливаются этим monitoring profile.
[Подробный flow](../../docs/flows/observability.md), [AC/evidence](../../docs/reports/wms-402.md).

Receiver обрабатывает SIGTERM/SIGINT явно: прекращает новые HTTP requests и ждёт
текущие до 2 s, затем закрывает зависшие соединения. Compose grace period 5 s.
Обычный stop завершается exit 0, включая работу Node как PID 1. Lifecycle исправлен
по реальному cleanup fault WMS-403; regression — незавершённый POST в child process
и Docker stop. [Результат WMS-403](../../docs/reports/wms-403.md).

## Установка и реальные команды

Нужны Docker, pnpm/Node из root manifest и свободные loopback порты. Лимиты памяти
monitoring services суммарно2496MiB; дополнительно нужны API/worker/PostgreSQL и Docker
overhead. Планировать запас Docker VM (например6GiB); это предварительная рекомендация,
не измеренный минимальный ресурс baseline WMS-403. Не запускать fault gate одновременно
с тяжёлым PostgreSQL coverage: они конкурируют за ресурсы VM.

```sh
# Рабочая .env здесь не читается: monitoring использует /dev/null и shell WMS_* overrides.
export WMS_APP_PROJECT=wms-app
export WMS_OBSERVABILITY_PROJECT=wms-observability
pnpm observability:up
# Application использует существующие local credentials; файл не переписывать.
# Это отдельный app project: PostgreSQL host port из .env должен быть свободен.
docker compose --env-file .env --project-name "$WMS_APP_PROJECT" -f infra/compose/compose.yaml -f infra/compose/compose.app.yaml -f infra/observability/compose.application.yaml up -d --build --wait api worker
```

Если нужен отдельный env-file, создать свой local ignored файл и явно заменить `.env`
в команде; не менять credentials существующей PostgreSQL data directory. Смена пароля
в env не меняет пароль уже созданной БД. Сеть monitoring должна существовать до app up.
Подключать только один app project к monitoring network: DNS targets api/worker фиксированы.
WMS_APP_PROJECT collector должен точно совпадать с --project-name приложения.

При конфликтах задать WMS_PROMETHEUS_PORT, WMS_LOKI_PORT, WMS_TEMPO_PORT,
WMS_OTLP_PORT, WMS_GRAFANA_PORT, WMS_ALERTMANAGER_PORT, WMS_RECEIVER_PORT.
Monitoring command `--wait` без healthcheck означает running; проверить HTTP readiness
ниже. Полный automated gate выполняет эти запросы и реальные business checks.

| Сервис       | Loopback default / проверка           | Данные                                                         |
| ------------ | ------------------------------------- | -------------------------------------------------------------- |
| Prometheus   | 9090 /-/ready                         | Scrape5s, API/worker9464, collector12345 и infrastructure      |
| Loki         | 3100 /ready                           | JSONL со structured metadata, только4 indexed labels           |
| Tempo        | 3200 /ready; OTLP HTTP4318 /v1/traces | Ручные безопасные spans WMS-401                                |
| Grafana      | 3001 /api/health                      | Anonymous Viewer, folder Warehouse,4 versioned dashboards      |
| Alertmanager | 9093 /-/ready                         | 4 rules, локальный receiver                                    |
| Receiver     | 9080 /notifications                   | Последние100 notifications в RAM                               |
| Alloy        | не опубликован                        | Docker discovery и Loki forwarding, metrics только внутри сети |

Host API/worker можно направить в Tempo через
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces. Host logs этим Docker
collector не читаются. Для Compose endpoint `http://tempo:4318/v1/traces` задаёт overlay.
Новый WMS_METRICS_PORT=9464 включается только overlay; обычный app:up остаётся прежним.

## Logs, CLI, metadata и поиск

Alloy v1.12.0 получает Docker socket и выбирает только wms.logs=true своего project.
Socket mount ro НЕ является API RBAC; использовать только доверенный local daemon.
Для внешнего стенда нужен scoped API proxy/collector RBAC, network policy, TLS/auth.
Discovery и source sync заданы отдельно по2s; default source60s мог пропускать CLI.
Короткий CLI без discoverable lifetime может быть потерян; gate держит test wrapper
до collector acknowledgement после независимого завершения CLI business work.
В Compose pod отсутствует; namespace означает Compose project, container — имя Docker.
Оба поля structured metadata, а не Loki labels. Для Kubernetes нужен отдельный collector
deployment/discovery: этот профиль не обещает установку K8S RBAC/DaemonSet.

Из JSON сохраняются operational records warehouse-backend с известными process/module/
environment; startup fallback unknown принимается. CLI result stdout и malformed lines
отбрасываются. UUID/errorCode/traceId остаются JSON fields, не index labels. Для CLI нужен
контейнер с собственным Docker network target; `docker exec` stdout не входит в PID1 log,
а `network=container` может не создать discovery target. Gate использует отдельный CLI
контейнер и явный loopback tunnel к своей DB; local opt-in/admin role не отключаются.

```logql
{service="warehouse-backend"} | json | correlationId="<UUID>"
{service="warehouse-backend"} | json | eventId="<UUID>"
{service="warehouse-backend"} | json | aggregateId="<UUID>"
{service="warehouse-backend"} | json | errorCode="DATABASE_REJECTED"
```

В Grafana открыть Warehouse dashboard, указать нужный textbox filter (default regex `.*`).
Loki derived TraceID открывает Tempo; в trace перейти к logs через custom traceId query.
Deferred handler trace связан producer link, поэтому у API и worker разные traceId.
Не сравнивать query-time поля `|json` с index labels: последние проверять через series API.
Dashboards: operation (HTTP включая probes + business outcomes), queue (count/age),
workers (scrape/outcomes), infrastructure (up/pool). JSON format не имеет комментариев:
файлы в grafana/dashboards — source, UI правка не меняет репозиторий.

## Alerts и bounded delivery

Rules: dead>0 for5s; active age>60s for5s; handling errors за1m либо durable dead/retry
for5s; missing scrape/DB snapshot failure for15s. Это предварительные dev thresholds,
не production SLO. Receiver только внутренний HTTP, внешних email/Slack сообщений нет.
Открыть /notifications: status firing/resolved, технические labels. Journal RAM ограничен
100 notifications×20 alerts; значения label до128 символов, body≤1MiB; restart теряет журнал.

Docker logging: non-blocking1MiB и json-file10MiB×3 на API/worker/migrate. После заполнения
buffer/rotation возможна потеря. Alloy: memory limit256MiB, batch256KiB, wait1s,
HTTP timeout2s, backoff500ms..2s, максимум3 retries. Sender WAL не включён, исчерпание
retries теряет batch с diagnostic. Positions в collector volume переживают restart,
но не обеспечивают exactly once: возможны replay/пропуски, особенно при file rotation.
Повреждение/удаление positions или Docker disk exhaustion — дополнительные риски;
доступность бизнес-операции при Loki outage не доказывает изоляцию от исчерпания host disk.

## Storage, доступ и cleanup

Prometheus24h или512MB blocks; WAL отдельно, это не жёсткая disk quota. Loki compactor
удаляет данные старше24h (TSDB/index24h), Tempo blocks retention24h. Удаление асинхронное,
active blocks/WAL требуют запаса диска. Loki ingestion2MB/s/burst4MB. Alertmanager
retention24h; Grafana сохраняет local DB. Следить за Docker VM disk usage. Usage reporting
отключён, Grafana background preinstall plugins отключён для воспроизводимого локального запуска.

Loki/Tempo без auth, published ports только loopback. Monitoring network доверенная.
Grafana anonymous Viewer не означает защиту от пользователя той же Docker VM; dev
настройки не предназначены для внешнего доступа или настоящих персональных данных.

```sh
# Сначала остановить app теми же -f/project/env-file; down сохраняет его PostgreSQL volume.
docker compose --env-file .env --project-name "$WMS_APP_PROJECT" -f infra/compose/compose.yaml -f infra/compose/compose.app.yaml -f infra/observability/compose.application.yaml down
pnpm observability:down
```

Monitoring down сохраняет все named volumes. Для явного уничтожения **только monitoring**:
`docker compose --env-file /dev/null --project-name "$WMS_OBSERVABILITY_PROJECT" -f infra/observability/compose.yaml down --volumes --remove-orphans`.
Проверить project перед командой: logs/traces/metrics/Grafana state удаляются необратимо.
Не применять volumes-флаг к существующему app project ради теста и не выполнять Docker-wide prune.

## Gate и диагностика

`pnpm observability:gate` — общий Docker business gate с monitoring hooks: чистые
projects, real HTTP/session/CSRF/SQL, age/dead/errors firing/resolution, production recovery
CLI, поиск API/worker/CLI, Tempo links, dashboards и отказ Loki/collector. После faults
новая команда должна снова появиться в Loki. Runtime log delivery не входит в business commit.
Gate finally удаляет только собственные UUID projects/volumes и temporary credentials.
После SIGKILL самого driver cleanup не гарантирован — использовать его project name,
не удалять соседние проекты. `pnpm docker:build` можно выполнить до gate, чтобы холодная
dependency install не вошла в короткий startup timeout Compose smoke.

Диагностика: `docker compose --env-file /dev/null --project-name "$WMS_OBSERVABILITY_PROJECT" -f infra/observability/compose.yaml logs --tail 50 collector loki prometheus alertmanager receiver`.
Искать retry/drop в collector, scrape_success/up в Prometheus, firing/resolved в receiver.
Read-only metrics aggregation может timeout-иться на большом outbox; это отдельная
диагностика неизвестного snapshot, не доказательство пустой очереди.

Форматы/компоненты сверены с [Alloy loki.process](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/),
[bounded write retries](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/) и
[Loki retention](https://grafana.com/docs/loki/latest/operations/storage/retention/).
