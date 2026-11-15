# ADR-0034. Singleton outbox publisher и fencing

Статус: принято в рамках WMS-503. Дополняет ADR-0032/0033; writer, envelope,
идентичность событий и local dispatcher [ADR-0003](0003-outbox-before-kafka.md) не заменяются.

## Решение

Отдельный процесс читает retained outbox через transport port. Destination
`kafka.publish` имеет собственные delivery rows и cursor. Подписка создаётся лениво
от версии1; включение требует `PUBLISHER_ENABLED=true`, `PUBLISHER_REPLAY=from-start`.
До старта проверяется полнота retained history: min1, max/count=last_version.
Режим boundary/cutover не реализован. Бизнес-транзакция не обращается к Kafka/Registry.

Publisher получает lifetime session advisory lock `(1464685363,503)` на dedicated
PostgreSQL соединении. Все claim/completion/retry SQL идут через него, без reconnect.
При закрытии соединение уничтожается, а не возвращается в pool. SQL transactions
короткие; network I/O выполняется между claim commit и completion transaction.

Один Kafka record передаётся в одной broker transaction. KafkaJS2.2.4:
`idempotent=true`, `maxInFlightRequests=1`, `acks=-1`, stable
`transactionalId=warehouse-outbox-publisher`, transaction timeout30s, bounded retries1.
Новый producer epoch fences старую transaction после потери DB owner session.
После uncertain outcome процесс завершается; повтор создаёт новый producer.
Consumer обязан использовать **read_committed**: aborted записи старого epoch
не должны становиться бизнес-входом. Это требование также внесено в AsyncAPI/flow.

Completion выполняется после transaction commit ack. Delivery status и stream cursor
меняются одной SQL transaction с проверкой token и предыдущего cursor. Между двумя
системами нет atomic commit. Потеря ack или SIGKILL после Kafka commit допускает
повтор с исходным eventId. Доставка **at least once**, не exactly once.

Один stream = aggregateType+aggregateId. Topic задаёт Git topology. Key — lowercase
aggregateId. Partition — первые4байта SHA256 UTF8 key как uint32 BE modulo3.
Алгоритм явный, одинаковый между рестартами; partition count проверяется при startup.
Рост partitions/смена key/hash запрещены без отдельного mapping/cutover плана.

## Развёртывание и ограничения

Optional Helm Deployment: replicas1, Recreate, grace60s; bounded process drain45s.
Нет HPA. Нельзя параллельно запускать publisher на разных БД с одним transactionalId
или на одной БД с разными ID. Recreate не останавливает изолированный узел.
DB lock и Kafka epoch дают дополнительный fencing; это не HA publisher.

При node partition successor может ждать, пока PostgreSQL увидит разрыв старой
session. Нельзя вручную снимать lock, не остановив старый процесс и не проверив
его node/container. После DB reconnect старый процесс не возобновляется.
Ротация transactionalId ради устранения блокировки запрещена. Recovery оператор
выполняет по [flow](../flows/publisher.md). Kafka consumers/cutover — WMS-504/506.

Новые3topics имеют dev retention64MiB/partition; receipt сохраняет256MiB/partition.
Это около1344MiB данных на PVC2GiB плюс internal logs/segments; hard disk quota и
гарантия семидневной истории не обещаются.

## Безопасность и совместимость

mTLS обязательно. Проверяется CA/server hostname; private keys только в файлах
Secret. ACL literal на4topics Write/Describe, cluster IdempotentWrite и точный
transactionalId Write/Describe. SDK logging отключён: raw errors/payload не печатаются.
Runtime PostgreSQL role не получает DDL. Migration0033 только расширяет destination
CHECK, старый worker продолжает собственную доставку inventory.putaway.

Registry check — release preflight, не runtime REST lookup. Прямой Node/Helm startup
сам не доказывает публикацию схем: оператор обязан выполнить `pnpm registry:check`
на том же Git artifact до enable. Ограничение trusted release boundary ADR-0033 сохраняется.

## Источники

[KafkaJS transactions](https://kafka.js.org/docs/transactions),
[Kafka producer configuration](https://kafka.apache.org/41/generated/producer_config.html).
Bounded retries выбраны для fail-stop/at-least-once, а не для Kafka EOS pipeline.
