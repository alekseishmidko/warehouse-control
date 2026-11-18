# ADR-0038. Репетиция переключения транспорта с сохранением outbox

Статус: принято техническое решение WMS-506 для локального dev-стенда.
Дополняет cutover-раздел [ADR-0035](0035-kafka-application-consumers.md) и
[ADR-0034](0034-outbox-kafka-publisher.md). Не заменяет их wire/ack/identity policy.

## Решение

Оператор останавливает все writers и оба транспорта на момент фиксации boundary.
Boundary — вектор `(consumer, aggregateType, aggregateId, lastProcessedVersion)`
с сохранёнными markers, eventId, transport cursors и pending set. Одного времени,
MAX(version), Kafka offset или общего количества сообщений недостаточно.

Для существующего `inventory.putaway` consumer cursor уже инициализирован локальным
worker. Kafka использует эти же строки. Для ещё не обработанного receipt отсутствие
cursor означает0. Нельзя устанавливать cursor=N по первому увиденному Kafka N+1:
нужны сохранённый prefix markers и предыдущий cursor. Новый logical consumer требует
отдельного replay/start-position решения и в эту процедуру не входит.

Publisher продолжает полный retained replay с1 по ADR-0034. Он публикует факты всех
четырёх aggregate topics; только receipt stream подписан `inventory.putaway`.
Переносится обязанность применить pending receipt effects, а не право переписать
доставки. Historical records с marker являются дубликатами. Local pending deliveries,
attempts и transport cursors не удаляются, не помечаются completed и не переводятся
в новое destination. Отдельной DDL migration для переключения не требуется.

После фиксации backup и boundary оператор запускает одного publisher и Kafka consumer
при закрытом HTTP. Сверяет pending set, inventory и offsets. Только после успешной
сверки открывает HTTP. Consumer offsets продвигает обычный runtime после DB commit;
оператор не применяет reset-offsets для пропуска истории. Publisher singleton остаётся
session lock + stable producer epoch, не только deployment replicas1.

## Возврат после новых Kafka-эффектов

Оператор снова закрывает запись, завершает consumer и publisher, сохраняет НОВЫЙ
backup/boundary. Старый pre-cutover backup не восстанавливается в исходную БД:
это потеряло бы новые подтверждённые операции. Local worker читает сохранённые
deliveries с прежним destination, пропускает уже применённые effects по markers и
догоняет transport cursor. Неприменённые deliveries выполняет по прежнему протоколу.
После сверки разрешается открыть запись. Повторный переход на Kafka начинается
с ещё одной новой границы, а не с сохранённого старого Kafka offset.

## Ограничения

Write freeze здесь операционный: остановка API и всех CLI/import writers. Нового
runtime maintenance flag нет. SQL snapshot не блокирует будущую запись и не доказывает,
что оператор остановил неизвестный writer. Нужны подтверждённый список процессов,
наблюдение закрытых listeners и одинаковые повторные snapshots при остановке.

Полный replay возможен только при полной retained PostgreSQL истории и достаточной
Kafka retention. Если broker удалил нужные записи после publisher completion,
publisher не отправит completed delivery повторно сам. Этот случай — STOP: не
сбрасывать markers/cursors/completions, требуется отдельный согласованный replay plan.
Произвольный poison и unresolved quarantine также не обходятся возвратом к worker.

Репетиция использует отдельные Testcontainers PostgreSQL и Kafka mTLS; она не
переключает рабочий kind/Strimzi deployment. Backup restore проверен в другой БД
того же disposable PG server с уже созданными roles. Restore на новый server,
production retention/key custody и HA требуют отдельной проверки.

[Порядок оператора, Mermaid и stop criteria](../flows/transport-cutover.md),
[AC/review/evidence](../reports/wms-506.md).
