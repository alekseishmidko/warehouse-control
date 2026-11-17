# ADR-0035. Kafka application consumer и retained identity

Статус: принято в рамках WMS-504. Дополнено [ADR-0037](0037-kafka-partition-recovery.md): opt-in partition recovery; legacy fail-stop сохранён. Дополняет [ADR-0034](0034-outbox-kafka-publisher.md),
[ADR-0015](0015-postgres-worker.md); local outbox transport не удаляется.

## Решение

Первый Kafka consumer подписан только на receipt topic. Logical consumer name и group
равны `inventory.putaway`. ApplicationConsumerService владеет общими handler/marker/cursor
правилами, ApplicationConsumerModule экспортирует только этот service. Kafka adapter не импортирует
private repositories и не пишет stock. ReceivingPostedHandler вызывает InventoryService.

Kafka record проходит JSON Schema2020-12, size/type/version, headers, key/topic/partition
и полное сравнение с retained immutable outbox envelope в той же PostgreSQL БД.
Это внутренний transport модульного монолита, не API для чужих источников событий.
DB cursor/processed markers сохраняются без смены name при смене transport.

Один batch/record обрабатывается последовательно, partitionsConsumedConcurrently=1.
Внутри DB transaction cursor блокируется FOR UPDATE; effect/marker/cursor — один commit.
Duplicate требует существующий marker и cursor>=version, после чего handler пропускается.
Без marker допустима только cursor+1. Gap/unknown version/ошибка приводят к fail-stop
всего consumer без offset commit. Это консервативно блокирует и другие partitions
этого instance до расследования. Quarantine/retry/partition-selective recovery — WMS-505.

Consumer читает read_committed. autoCommit/eachBatchAutoResolve выключены.
После PostgreSQL commit adapter ещё раз проверяет ownership/heartbeat, затем вручную
подтверждает offset+1 через BigInt. resolveOffset вызывается после broker ack.
Потеря ack или crash между DB и Kafka commit дают replay с прежним eventId.
Exactly once и distributed atomic commit не обещаются.

## Rebalance и остановка

KafkaJS2.2.4 не имеет synchronous revoke callback, пригодного как DB fencing token.
Epoch меняется на REBALANCING/GROUP_JOIN; heartbeat monitor вне callback runner
отзывает локальное ownership при ошибке. Проверки до/после application handler
откатывают transaction при уже замеченном revoke/SIGTERM. После неизвестного до commit
revoke DB effect может завершиться; следующий владелец увидит marker. Broker проверяет
generation/member offset commit; rejoin не происходит внутри старого eachBatch callback.
На ошибке ownership процесс fail-stop, SDK autorestart выключен.
Нет обещания, что PostgreSQL узнает о revoke одновременно с coordinator.

DB transaction_timeout<=10s, heartbeat1s, session15s. Graceful drain ограничен20s;
hard deadline завершает process с exit1. CPU-blocking handler не поддерживается.
Startup readiness требует group join; runtime readiness — assignment и PostgreSQL.
Liveness не зависит от broker/БД. Opt-in не выполняет migrations и не переключает worker.

## Cutover

По умолчанию отсутствующий Kafka offset означает fromBeginning. DB cursor никогда
не выводится из Kafka offset, не сбрасывается и не перескакивает к первой увиденной версии.
Тест N+1 использует завершённый local N и тот же logical name/cursor. Полная процедура
backup/write freeze/boundary/перенос deliveries/rollback остаётся WMS-506.
Retention Kafka может удалить необработанную историю; startup fromBeginning сам по себе
не доказывает её полноту. До cutover оператор сверяет retained outbox и границы Kafka.
Автоматический безопасный replay после retention gap пока не реализован.

## Источники

[KafkaJS consuming](https://kafka.js.org/docs/consuming),
[instrumentation events](https://kafka.js.org/docs/instrumentation-events).
Поведение generation/heartbeat дополнительно проверено по установленному source2.2.4
и настоящим broker rebalance; instrumentation событие не считается revoke barrier.
