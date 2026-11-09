# Эксплуатация и поставка

## Реализованный локальный стенд

Доступны host dev, Compose backend и single-node kind. Kubernetes manifests, Helm chart
API/worker/web и NGINX Gateway Fabric/TLS реализованы WMS-301–303. Это локальные стенды;
внешний production deployment, Kafka, observability stack и CI/CD pipelines не настроены.
Фактический статус — [карта](README.md), открытые findings — [отчёт ревью](reports/project-review-2026-11-07.md).

| Режим                | Запуск и владелец инструкции                                                                                 | Данные и границы                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Host dev             | pnpm dev:all; [flow](flows/dev-environment.md)                                                               | Compose PostgreSQL, host API/worker/Vite; общий shutdown оставляет БД/volume  |
| Контейнерный backend | pnpm app:up/app:migrate/app:down; [Compose](../infra/compose/README.md)                                      | Один backend image для API/worker/migrator; local DB owner, без frontend      |
| Kubernetes dev       | [kind/Helm](flows/kind-helm.md), [application](flows/kubernetes-app.md), [Gateway/TLS](flows/gateway-tls.md) | Отдельный PostgreSQL platform PVC, runtime/migration Secrets, web image и NGF |

Рабочую .env не перезаписывать. POSTGRES_* инициализируют только пустой data directory;
изменение env не меняет пароль существующего volume. Пользовательские данные не
удаляются ради gate. Безопасный порядок очистки описан у владельца выбранного режима.

## Startup, migrations и readiness

Compose PostgreSQL health проверяет `pg_isready -h 127.0.0.1`: временный socket-only
initdb server не считается готовым для migrator. После TCP healthy миграция должна
закончиться exit0, затем стартуют API/worker. Health не проверяет пароль, grants или
schema. [Regression R-02](../scripts/postgres-readiness.test.cjs) удерживает initdb barrier,
наблюдает настоящий health probe и незавершённый --wait до готовности TCP.

Kubernetes application chart не устанавливает PostgreSQL/NGF/CRDs. Оператор сначала
provision platform и Secrets. Pre-install/pre-upgrade Job запускает тот же backend
artifact с migration entrypoint; session advisory lock сериализует migrations на одном
DB client. Job failure не обновляет application Deployments. Новая schema обязана быть
совместима со старыми API/worker до конца rollout: expand, затем contract отдельным выпуском.
Rollback image не откатывает данные/события. Destructive migration требует отдельного
плана восстановления и forward fix. [Migration/recovery flow](flows/kubernetes-app.md).

API /health сохраняет liveness-контракт. WMS-304 добавляет отдельные
/health/startup, /health/ready и /health/live для API3000/worker9100. Readiness
зависит от PostgreSQL и drain; liveness не зависит от внешних сервисов. Worker
probe listener не имеет warehouse routes или Service. [Lifecycle/rollout](flows/lifecycle.md). Gateway Programmed
не доказывает готовность NGINX Pod: ждать data-plane rollout и реальную HTTP/TLS проверку.

## Images, конфигурация и полномочия

API/worker/migrator используют один immutable backend digest с разными entrypoints.
Web имеет отдельный non-root static image без DB/session credentials. Dockerfile stages
используют frozen lockfile; .dockerignore исключает .env и host artifacts. Runtime
root filesystem read-only; writable scratch ограничен, постоянные данные находятся в БД.
[Сборка и image checks](flows/docker-gate.md), [static server](../apps/web/server/README.md).

ConfigMap хранит несекретную policy. Существующие Secrets содержат runtime/migration
DATABASE_URL и TLS key; private values не включаются в rendered committed chart.
Kubernetes ServiceAccounts не получают автоматический API token или RBAC grants.
Runtime DB login отделён от DDL owner; dev Compose по-прежнему использует local admin.
Secret base64 не является шифрованием или защитой от администратора cluster.
SOPS/age, signing, внешний registry delivery и production credential provisioning не настроены.

Session/warehouse ACL обязательны; dev actor удалён. Production API требует HTTPS
AUTH_ORIGIN и явные absolute/idle seconds. TLS завершает NGF; /api сохраняется, / идёт
в static web. Trust proxy выключен, forwarded headers не выбирают actor/Origin.
Оператор явно настраивает dev DNS/hosts и доверие CA; ОС trust store автоматически
не меняется. [Identity](flows/identity.md), [Gateway/TLS](flows/gateway-tls.md).
Bootstrap — отдельный opt-in stdin CLI с DB group и retained marker, не API startup hook.

## Worker и recovery

Worker обрабатывает inventory.putaway в отдельном процессе. SIGTERM/SIGINT запрещает
следующий claim, ограниченно ждёт активную работу и закрывает pool. Deadline failure
даёт exit1; после crash доставка восстанавливается по expiry/token PostgreSQL lease.
Effect/marker/cursors/completion имеют один commit. Нельзя вручную сбрасывать markers,
курсор или историю attempts. [Worker](flows/worker.md), [recovery/runbook](flows/outbox-recovery.md).

Completed delivery вместе с pending PutawayTask — штатное состояние: worker создал
задание, сотрудник ещё не выполнил физическое размещение. Выполнение реализовано
WMS-203. Synthetic event без реального posted receipt не превращается в фиктивную
task: source FK приводит к permanent dead. Исправление причины и retry выполняются
явным local recovery CLI с DB admin role, operator/reason/audit/history.

## Проверки перед изменением и поставкой

`pnpm check:pr` реализован локально: format/typed lint/architecture/self-tests,
typecheck/build/contracts/OpenAPI/web generation, Vitest, реальные PostgreSQL/Chromium
и отдельные coverage guards. Это не внешний CI trigger или required status check.
`pnpm test:postgres:readiness` входит в check:pr и docker:gate; skip/fallback запрещены.
[Команды и правила](pr-checks.md), [coverage](quality.md).

Docker изменения дополнительно проверяют `pnpm docker:image-check` и `pnpm docker:gate`.
Kubernetes изменения проверяют `pnpm kubernetes:gate`, Gateway — `pnpm gateway:gate`.
Gates создают свои случайные projects/clusters/credentials/volumes и удаляют только их.
После изменения env/scripts/config повторяется исходный пользовательский entry point.
Код ошибки и ограничения проверки фиксируются в отчёте.

## Ещё не реализовано

- Kafka/Strimzi и broker failure tests; текущий transport — PostgreSQL outbox.
- Prometheus/Grafana/Loki/Tempo, Pino/OTel instrumentation и численные SLO/alert policy.
  Сейчас доступны безопасная worker delivery диагностика и local backlog signal CLI.
- Внешние CI/CD, image publishing/GitOps/Argo CD, автоматический compatibility comparison
  с основной веткой и vulnerability remediation pipeline.
- Проверенные HA/storage backups/restore, внешний DNS/load balancer, production Secrets
  и rollout на активных операциях. Single-node kind не доказывает эти свойства.

Эти работы выполняются отдельными этапами [плана](development-plan.md). Разрешение
изменить repository не является разрешением публиковать или разворачивать внешний стенд.

## Целевые требования следующих этапов

Для observability нужны HTTP latency/error rate, DB pool saturation, outbox
pending/retry/dead и возраст backlog, throughput, schema/dedup/lease/blocked-stream
диагностика, конфликты резерва и длительность транзакций. Kafka lag появляется после
подключения Kafka. eventId/productId/orderId нельзя использовать как metric labels
высокой cardinality. Dead delivery требует alert; численные SLO, retention и thresholds
фиксируются по baseline нагрузочного теста. Текущий local signal CLI не заменяет alert delivery.

Будущая OTel instrumentation должна переносить context через HTTP/event envelope.
Отложенная обработка может создавать отдельный trace со span link, а не держать
исходный span открытым часами. Секреты и полные bodies в логи/traces не передаются.

Внешняя PR pipeline должна выполнять frozen install, quality/contract compatibility,
image checks и Helm lint/render. Main delivery через registry/GitOps/Argo CD требует
отдельно выбранного окружения и разрешения. До GitOps требуется защищённое хранение
Secrets, например SOPS/age с ключом вне Git; сейчас такой механизм не установлен.

Нагрузочные k6 и будущие Kafka fault tests должны проверять конкуренцию за stock,
рост outbox, потерю broker ack, отказ broker, старые события и rollout. Существующие
PostgreSQL crash/rollback tests не доказывают поведение ещё не подключённого транспорта.
