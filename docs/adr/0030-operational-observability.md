# ADR-0030: общий operational logger и ручная трассировка

Статус: принято в рамках WMS-401. Уточняет [ADR-0006](0006-delivery-observability.md),
[ADR-0003](0003-outbox-before-kafka.md) и [ADR-0029](0029-process-lifecycle.md).

## Решение

Shared содержит контракт событий и безопасных scalar полей. Один infrastructure Pino
sink обслуживает API, worker либо CLI; ALS context и children используют тот же sink.
Operational JSONL идёт в stderr. CLI stdout сохраняет отдельный протокол результата;
его нельзя автоматически включать в collection логов. Nest/driver/OTel diagnostics
не могут выводить произвольный текст. Pretty — только явный local interactive opt-in.

OTel запускается до application imports. Ручные spans HTTP, operation, transaction,
handler не включают SQL/URL/headers/payload/stack. Resource autodetection и автоматические
instrumentations/log/metric exporters отключены. OTLP HTTP exporter включается endpoint;
без него SDK сохраняет рабочий context без внешнего I/O. Exporter/transport завершаются
после drain с общим отдельным budget3s. Логи/traces — best effort, не business audit.

HTTP принимает validated UUID correlation и W3C v00 traceparent. Outbox передаёт только
валидный traceparent, без baggage/tracestate. Каждая отложенная попытка worker начинает
собственный root CONSUMER trace с producer link: длинная очередь/повтор не продлевает HTTP
span. Старые события без traceparent допустимы, schemaVersion не меняется.

Успешные business-события внутри callback буферизуются до завершения COMMIT.
При ошибке буфер уничтожается. Подтверждённый ROLLBACK отличается от неизвестного outcome
COMMIT/rollback connection failure. Нет auto retry из-за ошибки sink/exporter.

## Причины и последствия

Auto instrumentation могла бы включить query/body/SQL или driver text, поэтому выбран
явный небольшой набор spans и полей. Framework diagnostics становятся менее подробными;
оператор получает стабильные события и error codes. Correlation IDs не определяют права
или audit scope. Link вместо remote parent отражает отложенную at least once доставку.
Loki/Tempo storage, dashboards, sampling policy стенда и SLO не входят в WMS-401.

[Подробный flow, ограничения и конфигурация](../flows/logging.md).
[Требования, review и evidence](../reports/wms-401.md).
