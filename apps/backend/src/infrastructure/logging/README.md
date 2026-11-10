# Единый Pino logger и OTel adapter

## Бизнес-назначение

Оператор ищет HTTP-команду, документ и доставку без раскрытия credentials/персональных
данных. Operational log не заменяет AuditService и не определяет результат транзакции.

## Техническое устройство и взаимодействие

`pino-logger.ts` сериализует выбранные поля в JSONL и изолирует ALS scopes/children.
`runtime-logger.ts` владеет sink процесса, Nest adapter, безопасными spans attributes
и буфером транзакции. `startup.ts` определяет executable по полному dist path и запускает
logging/SDK до Nest/application imports. `telemetry.ts` создаёт ручные spans и OTLP exporter.
Каталог/allowlist принадлежит shared/logging. Модули вызывают logEvent/logScope, а не создают
свои logger. API/worker/CLI используют одну схему; CLI result stdout остаётся отдельным каналом.

Данные: boundary context → safeLogFields → фиксированные event/level/message → Pino stderr.
Runtime transaction buffer откладывает sink до COMMIT и уничтожается при rollback.
Module child и ALS наследуют только безопасные bindings. SDK не собирает SQL/URL/headers.
Полный порядок HTTP → outbox → linked root consumer, ошибки и shutdown описаны у
[владельца flow](../../../../../docs/flows/logging.md); решение — ADR-0030.

## Конфигурация и ошибки

По умолчанию JSON stderr. `LOG_FORMAT=pretty` допустим только в development с interactive
stderr и без `LOG_COLLECTOR_ENABLED=true`. Для collector — json и флаг true. Неизвестный
формат/запрещённый pretty останавливает startup безопасной JSON строкой CONFIG_INVALID.
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces` включает OTLP/HTTP.
Без endpoint нет сетевого export, но context/IDs работают. URL без credentials/query/hash.
Exporter не устанавливает collector. SDK diagnostics перенаправлены в фиксированные события.
Info — lifecycle/успех; warn — rejection/rollback/retry; error — отказ/dead/unknown outcome.
Sink ошибки best effort, без business retry. Нет гарантии доставки диагностических записей.
Shutdown идёт после drain, имеет общий предел3s; SIGKILL не гарантирует flush.

## Пример после подтверждённого commit

```json
{
  "timestamp": "2026-11-10T08:00:00.000Z",
  "level": "info",
  "service": "warehouse-backend",
  "environment": "development",
  "process": "api",
  "module": "receiving",
  "event": "receiving.posted",
  "message": "Receipt posted",
  "correlationId": "dbb37b21-1c4a-4b32-9307-148df1647f4c",
  "aggregateId": "3e95a269-e552-401b-b3f0-85bc568d845b",
  "eventId": "ea61486b-df97-4421-9fa8-28587ad61d8c",
  "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "spanId": "bbbbbbbbbbbbbbbb",
  "durationMs": 42
}
```

Это иллюстрация формата с синтетическими ID, не скопированный production log.
Реальный receipt/replay/retry/rollback flow проверяет observability integration suite.

## Команды диагностики

```sh
# Операционные записи отдельно от stdout результата CLI или wrapper pnpm.
node apps/backend/dist/infrastructure/database/check.js 2>cli.jsonl
node apps/backend/dist/main.js 2>api.jsonl
# У контейнера оба потока приложения доступны Docker; API/worker выводят JSON приложения.
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.app.yaml logs --no-log-prefix api worker
# Parse всех строк; select выполняется после проверки JSON, не скрывает повреждённую строку.
jq -c . api.jsonl
jq -c 'select(.aggregateId == "3e95a269-e552-401b-b3f0-85bc568d845b") | {event,eventId,correlationId,traceId,spanId}' api.jsonl
jq -c 'select(.eventId == "ea61486b-df97-4421-9fa8-28587ad61d8c")' worker.jsonl
jq -c 'select(.event == "delivery.retry" or .event == "delivery.dead" or .event == "transaction.failed")' worker.jsonl
```

По traceId искать span в выбранном backend трассировки; worker trace имеет link на producer
HTTP trace. Развёртывание Tempo/Loki, retention и alerts — WMS-402. CLI stdout (включая
явно запрошенный inspect payload) нельзя направлять в operational collector.

## Тесты

`test/unit/logging.spec.ts`: обязательные поля, JSON каждой строки, child/parallel context,
allowlist, malformed IDs/identity, синхронная sink failure. `test/unit/telemetry.spec.ts`:
SDK resources/error status, no-export context, buffering, безопасный Nest/fallback,
нативный pretty transport и real local OTLP HTTP export. `environment.spec.ts` проверяет
loader и precedence в настоящем Node. `test/integration/observability.spec.ts`: HTTP+SQL,
producer/consumer links, replay/parallel requests, retry, deferred COMMIT и lost ROLLBACK ACK.
`outbox.spec.ts` проверяет старые события/extension validation без активного SDK.
[AC и фактические команды](../../../../../docs/reports/wms-401.md).
