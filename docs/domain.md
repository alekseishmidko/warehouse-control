# Домен и инварианты

## Текущее состояние

Реализованы приёмка, размещение, явный резерв, сборка, отгрузка и компенсационная
отмена по B1–B4. Документ описывает работающую модель WMS-104–208; история отдельных
этапов находится в reports. Неизменяемые бизнес-правила принадлежат
[правилам fulfillment](fulfillment-rules.md), подробности исполнения — владельцам flows.
Одна организация использует несколько складов и адресные ячейки. Партии, серии,
сроки годности и межскладской перенос не реализованы.

| Сущность                       | Назначение и владелец                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Product                        | Общий каталог организации, уникальный SKU; catalog                      |
| Warehouse / Location           | Склад и принадлежащая ему ячейка receiving/storage/shipping; warehouses |
| Receipt / ReceiptLine          | Фактическая приёмка с immutable составом; receiving                     |
| StockBalance / StockMovement   | Остаток и неизменяемое основание физического изменения; inventory       |
| StockAllocation                | Количества резерва и история его использования; inventory               |
| PutawayTask                    | Задание receiving→storage из posted receipt; inventory                  |
| Order / PickingTask / Shipment | Заказ, план/факт сборки и документ отгрузки; fulfillment                |
| AuditEntry                     | Субъект, действие, объект, основание и безопасные changes; audit        |

## Количества, остатки и резерв

Количество хранится как PostgreSQL int4 и JavaScript number в целых штуках.
Остаток — 0..2147483647, положительная операция — 1..2147483647.
Остаток уникален по `(warehouseId, locationId, productId)`; composite FK защищает
принадлежность ячейки складу. Отсутствующую строку нельзя защитить SELECT FOR UPDATE:
создание использует unique constraint и согласованный порядок INSERT/locks.

Для каждого balance:

- `available = onHand - reserved`, `0 <= reserved <= onHand`.
- `reserved = SUM(active allocations)` без legacy исключений.
- Новые резервы выбираются только из storage.

Для allocation: `allocated = active + released + transferred + consumed`.
Начальное allocated и основание неизменяемы; закрытые количества не переписываются.
Повторный резерв после release создаёт новое основание. Reserve/release меняют
reserved, но не создают физический movement и не меняют onHand.

Для строки заказа:
`ordered = open + reservedStorage + reservedShipping + shipped + cancelled`.
Сумма active+consumed не превышает ordered. Сборка переносит onHand и active
allocation вместе в shipping. Shipment уменьшает onHand/reserved и увеличивает
consumed. Проверки приложения и SQL guards работают совместно.
[Резервирование](flows/reservations.md), [сборка](flows/picking.md),
[отгрузка и ledger](flows/shipping.md).

## Приёмка и размещение

Receipt создаётся в draft для одной receiving location одного склада: 1..1000 строк,
разные productId, каждое quantity>0 в int4. Posting блокирует header, повторно проверяет
состояние/refs и начисляет stock через InventoryService в порядке productId.
Receipt posted, stock/movements, audit, ReceivingPosted и saved HTTP result получают
один commit. Новый key для posted receipt даёт409, прежний key возвращает saved result.
Редактирование/удаление строк и исправление posted документа этим API не предоставлены.
Частичная фактическая приёмка оформляется отдельными документами; модель ожидаемой
поставки не реализована. [Приёмка](receiving.md).

Worker создаёт pending PutawayTask на каждую строку реального posted receipt, без
повторного начисления stock. Task/audit/processed marker/cursors/delivery completion
фиксируются атомарно. Completed delivery означает создание задания, а не его
физическое выполнение. [Создание task](flows/putaway.md).

Оператор выполняет pending task целиком receiving→storage того же склада. Источник
и quantity берутся из task; target выбирает оператор. Свободный stock должен покрыть
quantity. Два movements, audit, completed task, PutawayCompleted и HTTP result
коммитятся вместе; общий stock склада не меняется. Произвольный перенос, partial
putaway и отмена task не реализованы. [Исполнение](flows/putaway-execution.md).

## Заказ, сборка, отгрузка и отмена

Order имеет состояния draft/active/cancel_pending/completed/cancelled/closed_mixed.
Confirm переводит draft в active без stock эффекта. Явный reserve может покрыть часть
заказа; нехватка любой строки откатывает весь запрошенный вектор. Release возвращает
количество в open и не означает отмену заказа. Автоматического expiry/TTL/job нет.

PickingTask хранит immutable план storage allocations. Состояния:
ready/in_progress/shortage/completed/cancelled. Сотрудник принимает задание сам;
возобновить shortage может прежний исполнитель. Факт — приращение количества.
Нехватка не списывает stock автоматически и сохраняет недособранный резерв.
Частичная сборка и последующее продолжение разрешены по B1/B2.

Shipment draft хранит выбранную staged партию. Posting повторно проверяет active
shipping allocations и списывает все строки документа атомарно. Статусы shipment:
draft/posted/cancelled. Отгруженный факт не отменяется. Полностью shipped заказ — completed.

Если staged товара нет, cancel освобождает storage резерв и закрывает неотгруженный
остаток. При staged товаре заказ становится cancel_pending; запас и резерв сохраняются
до полного подтверждённого физического возврата в storage. Возврат освобождает резерв
и закрывает только неотгруженный остаток: cancelled либо closed_mixed при прежних
отгрузках. История picked/shipped сохраняется. [B1–B4](fulfillment-rules.md),
[состояния и физический возврат](flows/shipping.md).

## Транзакции, повторы и события

Все бизнес-изменения, движения, allocations, audit, outbox и saved HTTP result
используют один awaited TransactionContext. Владелец сценария открывает runner;
вызываемые services не открывают nested transaction и не выполняют внешнее I/O.
Locks выбираются до мутаций в стабильном порядке; состояние перечитывается после ожидания.

Runner выполняет callback один раз. Deadlock/serialization/DB failure выходят наружу
без автоматического retry. При неизвестном результате HTTP клиент сохраняет исходный
request/key; явный повтор использует тот же key и заново проверяет session/warehouse ACL
до replay. Новый ключ не заменяет восстановление неизвестного исхода.
[Транзакции](transactions.md), [HTTP idempotency](../apps/backend/src/infrastructure/idempotency/README.md).

События — durable факты с envelope и проверкой schema до outbox INSERT и до consumer
эффекта. Общий лимит сообщения262144 UTF-8 bytes включает envelope/extensions;
ReceivingPosted v1 содержит1..1000 строк. Delivery at least once; effect/marker/cursors/
ack — один commit. Нет обещания exactly-once, общего порядка всех агрегатов или атомарности
PostgreSQL+Kafka. Kafka пока не подключена. [Контракты](contracts/README.md), [outbox](outbox.md).

## Авторизация, аудит и история

Actor/roles задаёт проверенная серверная session, не body/headers. System admin без
warehouse role не получает складской доступ. Session/CSRF/Origin и актуальный warehouse
ACL проверяются до каждой команды/replay. Dev actor bypass отсутствует.
[Identity](identity.md), [HTTP flow](flows/identity.md).

Бизнес-аудит пишет AuditService с безопасными changes/reasonCode в той же транзакции;
ошибка аудита откатывает сценарий. Пароли, токены и полные HTTP bodies не сохраняются.
История/movements immutable для runtime role; исправления требуют новых фактов и
отдельно реализованного сценария. Общий API корректировки stock не предоставлен.
DB admin может обходить runtime guards: это не криптографический журнал.

Складские списки требуют read/audit ACL. Cursor связан с фильтрами, сохраняет
microseconds; страницы не обещают общий snapshot. Audit scope определяется retained
объектом, а не JSON changes/correlationId. [Чтение и история](flows/warehouse-reads.md).

## Проверки и ограничения

Настоящие PostgreSQL tests проверяют duplicate/replay, locks, rollback, constraints,
allocation reconciliation, движения, audit/outbox и worker effects. Chromium gate
проверяет полный складской flow. Связь требований с evidence находится у владельцев
flows и в [отчётах ревью](reports/project-review-2026-11-07.md).
Успешные tests не доказывают все конкурентные расписания; открытые findings отмечены
в отчёте отдельно. Текущий статус и следующие этапы — [карта](README.md) и [план](development-plan.md).
