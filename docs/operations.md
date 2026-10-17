# Эксплуатация и поставка

Всё ниже — требования к будущему стенду; manifests и pipelines пока отсутствуют.

## Локальный запуск

Compose: PostgreSQL и приложение; профили Kafka и observability включаются отдельно.
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
