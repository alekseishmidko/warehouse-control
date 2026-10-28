# Эксплуатация и поставка

PostgreSQL Compose и проверки WMS-101 реализованы: [инструкция](../infra/compose/README.md),
[отчёт](reports/wms-101.md). Dockerfile API/worker и Compose overlay реализованы WMS-112;
Kubernetes manifests и pipelines пока отсутствуют.
WMS-102 добавляет изолированные Jest/Supertest/Testcontainers проверки:
[инструкция](../apps/backend/test/README.md).
Раздел WMS-112 ниже описывает реализованный стенд; Kubernetes/observability/CI — целевые требования.

## Локальный запуск

Compose: PostgreSQL и приложение готовы; профили Kafka и observability пока не реализованы.
kind: тот же образ приложения в локальном Kubernetes, инфраструктура через Helm.
Закреплять версии образов; опубликованные deployment images использовать по digest.
API и worker используют один backend image с разными entrypoints.
Dockerfile: multi-stage, frozen lockfile, production dependencies, non-root user,
корректная передача SIGTERM. Секреты не попадают в layers или build arguments.

## Kubernetes

- Отдельные Deployments API, outbox worker и consumers, Services по необходимости.
- Gateway API + NGINX Gateway Fabric; `/api` в backend, `/` в frontend.
- Настраиваемые requests/limits, securityContext, read-only filesystem где возможно.
- Startup probe допускает инициализацию; liveness проверяет процесс, а не Kafka/БД.
- Readiness API отражает возможность обслуживать запросы; сбой Kafka сам по себе
  не выключает API, пока PostgreSQL и outbox доступны и backlog в допустимых пределах.
- SIGTERM: прекратить новый claim/приём, завершить текущую работу с timeout,
  закрыть соединения; незавершённая работа восстанавливается протоколом доставки.
- Миграции — один управляемый Job перед rollout, не init каждого pod.
- Изменения БД — expand/contract, совместимость со старой версией при rolling update.
- ConfigMap для обычных настроек, Secret для чувствительных. Secret base64 не шифрование;
  GitOps-секреты шифруем, например SOPS + age, ключ хранится вне Git.
- Kafka в kind через Strimzi на соответствующем этапе. Один broker допустим только
  для dev и не доказывает отказоустойчивость.
- HA PostgreSQL и storage/backups выбираем отдельно до внешней эксплуатации.

## Наблюдаемость

Pino JSON logs: service, environment, requestId, correlationId, eventId,
consumer, attempt. Содержимое секретов и полные bodies не логируем.
OTel context передаётся через HTTP и event envelope. Отложенная обработка может
создавать новый trace со span link на исходный; не держим один span открытым часами.

Prometheus/Grafana:

- HTTP latency/error rate и DB pool saturation.
- Число pending/retry/dead, возраст старейшего события, throughput outbox.
- Ошибки схемы, dedup hits, lease expiry, blocked streams.
- Kafka consumer lag после миграции.
- Конфликты резервирования и длительность транзакций.

eventId, productId и orderId не использовать как labels метрик высокой cardinality.
Loki хранит логи, Tempo — traces. Численные SLO, retention и alert thresholds
фиксируем после baseline нагрузочного теста; dead delivery требует alert с первого дня.

## CI/CD

PR: frozen install → typecheck/build → unit/integration/contract tests →
проверка схем и совместимости → сборка/сканирование image → Helm lint/render.
Команды ещё предстоит настроить; зелёный build пока не означает эти проверки.
Main: immutable image в GHCR → изменение версии в GitOps → Argo CD sync.
Использование GitHub/GHCR зависит от места размещения репозитория.
Изменения внешнего окружения выполняются только в рамках отдельной задачи.

Rollback образа не откатывает данные и события. Destructive migration и несовместимые
events запрещают автоматический rollback; нужен runbook и forward fix.

## Проверки отказов

Testcontainers: PostgreSQL; Kafka после подключения транспорта.
k6: конкуренция за один остаток и throughput при росте outbox.
Убийство worker до/после commit, потеря broker ack, недоступность Kafka,
ошибочная схема, рестарт pod и rollout при старых событиях.
Для локального стенда отдельные профили уменьшают потребление памяти.

## WMS-103: полномочия БД

Audit migrations создают NOLOGIN permission group warehouse_app и append-only trigger.
Для внешнего стенда нужны отдельные migration owner и непривилегированный runtime login;
credential provisioning не включён в schema migration. Текущий dev Compose admin URL
не становится runtime login автоматически. Правила: [transactions](transactions.md).


## Локальный worker WMS-109

После явных migrations/build запуск `pnpm worker` отдельным процессом, API отдельно.
Worker HTTP-порт/readiness endpoint не открывает. WMS-110 регистрирует inventory.putaway;
только явно пустой registry оставляет pending без обработки. SIGTERM/SIGINT stop claim,
bounded drain/close; exit=1 при hard deadline, после crash ждём expiry PostgreSQL lease.
Config/defaults, DB timeout, диагностика и ограничения —
[worker README](../apps/backend/src/infrastructure/worker/README.md).
Не сбрасывать markers/cursors/lease вручную; локальный recovery CLI реализован WMS-111,
использовать проверенный runbook с role/lease/cursor checks.


## Durable handler WMS-110

Production worker теперь автоматически обрабатывает pending inventory.putaway в PutawayTask.
Требуются migrations 0013/0014/0015; env/команда worker не изменились. Проверить одну БД API/worker.
Состояние completed delivery + pending task штатно: бизнес-результат consumer достигнут,
физическое выполнение размещения ещё впереди. [SQL receipt/event/task](examples/putaway-result.sql).
Historical synthetic outbox facts без реального posted receipt станут permanent dead по source FK;
их нельзя превращать в фиктивные задания, менять stock либо перепубликовывать с новым eventId.
Управляемые inspect/retry — WMS-111, без автоматического reset истории при выпуске.

## Реализованный локальный Docker WMS-112

API/worker/migrate используют один multi-stage non-root image. Запуск `pnpm app:up`
с отдельным CONTAINER_DATABASE_URL, остановка `pnpm app:down` сохраняет volume.
Изменения SQL применяются отдельным migration process; без успешной migration
зависимые процессы не запускаются. Постоянная readiness и worker probe ещё не готовы.
`pnpm docker:image-check` проверяет clean context/layers, `pnpm docker:gate` — реальный
сценарий и shutdown на одноразовом стенде. Подробности и ограничения —
[Docker flow](flows/docker-gate.md), [Compose](../infra/compose/README.md),
[evidence](reports/wms-112.md). Локальные image не публиковались, production login/
секреты/Kubernetes/NGINX остаются будущими задачами.
