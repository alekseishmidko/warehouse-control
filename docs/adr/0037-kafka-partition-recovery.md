# ADR-0037. Durable Kafka partition recovery

Статус: принято в рамках WMS-505. Расширяет fail-stop [ADR-0035](0035-kafka-application-consumers.md)
отдельным opt-in режимом. Хранение raw ограничено согласованным [ADR-0036](0036-dev-kafka-quarantine-storage.md).

## Решение

Transient ошибки получают3committed failures на budget с1s/2s backoff. Permanent,
unknown schema, identity mismatch и aggregate gap сразу блокируют partition в quarantine.
Другие агрегаты в той же partition ждут. Другие2partitions работают независимо.
Consumer использует concurrency3 между partitions, последовательный await внутри каждой.
Ни quarantine, ни retry не подтверждают ошибочный offset и не продвигают consumer cursor.

Earliest unresolved source offset хранится в PostgreSQL. Partition advisory lock общий
для gate, business transaction и recovery. Global quota lock сериализует общий raw budget.
При старте после blocked offset consumer возвращается к оригинальной позиции, а не
подтверждает последующую. В effect transaction участвуют прежние application handler,
marker/cursor и resolution quarantine. Offset ack остаётся после commit и ownership check.

Failure transaction выполняется после rollback эффекта. Исходный encrypted snapshot
immutable. Manual retry открывает budget и AuditService в одном commit, не меняет eventId,
raw, markers/cursors или broker offset. Export/cleanup — отдельные explicit local admin
commands. DB admin role проверяется сервисом, CLI дополнительно требует local opt-in.

## Совместимость и ограничения

Без CONSUMER_RECOVERY_ENABLED=true старый запуск не требует ключа и сохраняет fail-stop.
Однако durable gates проверяются и в старом режиме: выключение crypto не является обходом.
Migration0034 additive и не меняет существующие tables/handlers. Новые columns не выдаются HTTP.

Bounded retries относятся к committed failures, не к crash до failure commit. Нельзя
обещать exactly once, мгновенный revoke или полноту Kafka history после retention.
Oversize/quota/key/DB failure прекращает process без ack; plaintext fallback отсутствует.
Crypto profile и custody keys ограничены локальным dev, не production deployment.

Подробный flow и команды — [владелец](../flows/kafka-consumer.md#wms-505-durable-partition-gate-и-encrypted-recovery),
AC/evidence — [отчёт](../reports/wms-505.md).
