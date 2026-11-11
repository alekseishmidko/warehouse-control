# ADR-0031: локальный pull monitoring и Alloy collector

Статус: принято для WMS-402. Уточняет [ADR-0030](0030-operational-observability.md)
и [ADR-0006](0006-delivery-observability.md); business audit и at least once сохраняются.

## Решение

Observability устанавливается отдельным Compose project. Application overlay только
подключает сеть, OTLP endpoint, opt-in metrics и bounded Docker logging. Обычный app:up
не получает новые обязательные настройки. Kubernetes collector/Secrets не устанавливаются.

Grafana Alloy v1.12.0 выбран для Docker discovery, JSON parsing, structured metadata и
ограниченных retries. Он читает только контейнеры opt-in wms.logs=true из одного app
project. Четыре indexed Loki labels — service/environment/process/module. Docker
project/container — structured metadata, Compose не имеет pod. UUID/trace IDs/errorCode
остаются полями исходной JSON строки. CLI result stdout и не-JSON не отправляются в Loki.
Fallback environment=unknown принимается. Docker socket mount ro не даёт API RBAC:
это доверенный dev daemon, не безопасный внешний collector deployment.

Приложение пишет Pino stderr и не знает Loki URL. Docker non-blocking buffer и rotation
ограничены; Alloy batch/backoff конечны, WAL отправителя не включён. Логи могут теряться
или повторяться. Exactly once не обещается. Docker/host disk exhaustion — общий ресурсный
отказ, его нельзя приравнять к изолированной недоступности Loki.

Prometheus pull использует отдельный internal listener9464, без warehouse routes.
HTTP histogram и фиксированные event counters наблюдают те же committed boundaries,
но не зависят от успеха sink. DB gauges используют существующий pool; queue snapshot
read-only, single-flight, SQL timeout750ms. Один snapshot на API/worker — дубликаты одного
набора данных, поэтому alerts/dashboards берут max, не sum. Это dev read aggregation,
не оптимизированная production read model или PostgreSQL server exporter.

Alerts отправляются только локальному HTTP receiver. Journal ограничен100 записями,
20 alerts/record и128 символами технического label value; payload limit1MiB. Внешних
email/Slack/webhooks нет. Initial thresholds не являются production SLO.

## Последствия и проверка

Роли/session/CSRF, stock, lease fencing и recovery budget не меняются. Fault drill
добавляется hooks к общему Docker business gate, а не копирует складские алгоритмы.
Dead вводится SQL trigger только в disposable БД; recovery выполняет production CLI
с local opt-in и DB admin role через явный локальный tunnel. Физический stock SQL не меняется.

[Владелец flow/диагностики](../flows/observability.md),
[AC и фактические проверки](../reports/wms-402.md).
