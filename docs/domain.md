# Домен и инварианты

## Модель первого релиза

WMS-104: количество — SQL integer и JavaScript number в целых штуках,
остаток 0..2147483647, приход 1..2147483647. Диапазон зафиксирован в shared, SQL
и draft event schema; опубликованного stock API пока нет.
WMS-105: первый документ приёмки ограничен 1..1000 строками, каждое фактическое
количество — 1..2147483647. Событие вместе с envelope/расширениями — до 256 КиБ
JSON UTF-8. Большую приёмку разделяют на документы до проведения; автоматического
дробления событий нет. Runtime contract и документ/HTTP DTO реализованы WMS-105/108.
SKU уникален в организации. Ячейка принадлежит ровно одному складу.
Системные зоны: приёмка, хранение, отгрузка. Только разрешённые для резервирования
остатки хранения участвуют в автоматическом выборе под заказ.

| Сущность                               | Назначение                                           |
| -------------------------------------- | ---------------------------------------------------- |
| Product                                | SKU и свойства товара                                |
| Warehouse / Location                   | Склад, ячейка и её назначение                        |
| Receipt / ReceiptLine                  | Ожидаемое и фактически принятое                      |
| StockBalance                           | Количество по `(warehouseId, locationId, productId)` |
| StockMovement                          | Неизменяемые записи движения с бизнес-основанием     |
| Reservation                            | Резерв строки заказа на конкретном остатке           |
| OutboundOrder / PickingTask / Shipment | Заказ, сборка, отгрузка                              |
| AuditEntry                             | Субъект, действие, объект, время и корреляция        |

## Остатки

`available = onHand - reserved`, всегда `0 <= reserved <= onHand`.
В целевой модели сумму reserved составляют все активные allocations на соответствующий balance;
сами reservations/allocations ещё не реализованы.
Ограничения проверяются в БД и приложении; отсутствующая строка остатка
не защищается `SELECT FOR UPDATE`, поэтому создание требует unique constraint
и корректного upsert/повторного чтения.

- Приёмка: приход в ячейку приёмки, проведение документа и событие — одна транзакция.
- Размещение: уменьшение источника и увеличение назначения — одна транзакция.
- Резерв: доступность проверяется вместе с записью резерва в одной транзакции.
- Сборка: товар и его резерв перемещаются в зону отгрузки; общий onHand склада не меняется.
- Отгрузка: onHand и reserved уменьшаются одновременно на фактическое количество.
- Отмена резерва: reserved уменьшается, onHand не меняется.
- Корректировка: отдельное движение с причиной и полномочиями; прямое редактирование запрещено.

Несколько строк блокируются в детерминированном порядке. Ошибки deadlock
и serialization допускают ограниченный повтор всей транзакции.
Событие и audit нельзя записывать вне этой транзакции.

## Статусы

Приёмка первого сценария: `draft → posted`. После проведения строки неизменяемы;
исправление — отдельная компенсирующая операция. Один документ проводится один раз.
Частичная приёмка оформляется отдельными документами фактической приёмки
против ожидаемой поставки; модель поставки появится отдельной задачей.

Резерв: `active → consumed | released`. Частичное потребление ведётся
количествами allocation; политики WMS-201.2/201.3 утверждены 2026-10-29,
см. [правила и проект переходов](fulfillment-rules.md). Состояние closed_mixed для смешанного
закрытия предлагается там отдельно и не считается принятым правилом.
Не выводить статус заказа только из факта получения одного события.

## Аудит

Бизнес-аудит пишется при успешной операции в общей транзакции:
actorId/type, action, entityType/id, timestamp, correlationId, reason и безопасные
изменённые поля. Токены, пароли и полные HTTP payload не сохраняются.
Неуспешные попытки доступа логируются отдельно от бизнес-аудита.
Движения и audit append-only для роли приложения; исправления добавляют запись.
Это не защита от администратора БД и не криптографический журнал.

## Обязательные проверки

Конкурентный резерв последней штуки; повтор проведения приёмки;
rollback без движения и события; перемещение без изменения общего количества;
сборка с переносом allocation; отгрузка без отрицательных остатков;
неавторизованная корректировка; повтор доставки без повторного эффекта.

## Реализация аудита WMS-103

Write interface и append-only таблица реализованы; user/system actorId и entityId — UUID,
основание — reasonCode, время — transaction timestamp PostgreSQL. Допустимые changes
и политика redaction/ролей: [transactions](transactions.md). Произвольные комментарии
вместо кода основания не сохраняются. Приёмка с аудитом реализована WMS-108; прочие складские сценарии предстоят.

## Реализованный складской baseline WMS-104

Catalog/Warehouses владеют внутренними справочниками; InventoryService.receive
атомарно увеличивает balance, пишет audit и immutable movement. Отсутствующий
balance создаётся guarded upsert с unique stock key. Location ownership защищён
composite FK. Повтор operationId отклоняется с rollback, не считается успехом.
Размещение, резервирование и отгрузка в правилах выше остаются целевыми сценариями.
Детали/DTO/ограничения: [stock-baseline](stock-baseline.md).

## Реализованный outbox writer WMS-106

OutboxService принимает факт с общим context после бизнес-изменения, сам выделяет
UUID/непрерывную event version в транзакции и пишет immutable envelope, pending delivery
и stream. Атомарность с stock/movement/audit доказана integration-тестом, документ
приёмки/проведение реализованы WMS-108. Повтор append создаёт новый факт: запрет
повторного posting обеспечивает receiving parent lock/state, HTTP replay — idempotency storage.
[Физическая модель и ограничения](../apps/backend/src/infrastructure/outbox/README.md).

## Приёмка WMS-108

Draft и строки создаются атомарно; HTTP редактирования/удаления нет. Один документ —
одна receiving location склада, 1..1000 строк с разными productId, quantity int4 > 0.
Posting сначала блокирует header, повторно проверяет refs/состояние и вызывает inventory
по productId. UUID строки = operationId движения. Receipt audit, stock/audit/movements,
ReceivingPosted, delivery/stream и результат HTTP атомарны. postedAt = occurredAt события;
aggregateId = payload.receiptId. Новый ключ на posted — 409, прежний — saved replay.
Документ не моделирует ожидаемую поставку/частичную приёмку/коррекцию.
[Полный контракт](../apps/backend/src/modules/receiving/README.md).

## Ожидание размещения WMS-110

PutawayTask pending создаётся worker на каждую строку posted receipt и не начисляет
stock. Unique source line/event и composite FK сохраняют исходные receipt/product/quantity/
location/event. Worker effect, task audit, processed marker, consumer/transport cursors и
completion фиксируются вместе. Delivery completed не означает task completed: выполнение требует отдельной команды WMS-203. Source task immutable, корректировка/отмена не появились.
[Подробный flow](flows/putaway.md), [ADR-0016](adr/0016-durable-putaway-handler.md).

## WMS-201: принятые правила будущего fulfillment

[Проект правил](fulfillment-rules.md) содержит таблицы разрешённых/запрещённых переходов
заказа, задания сборки, резерва и shipment. Владелец продукта принял B1–B4 2026-10-29:
частичные сборка/отгрузка с открытым остатком, подтверждение найденного с сохранением
недособранного резерва, отмена собранного через физический возврат, без автоматического
expiration. Недостача не списывается автоматически, shipped не отменяется. Дополнительные
меры блокировки позиции и точные schema/статусы остаются проектом, а не готовой реализацией.

По рекомендованной модели строка заказа объясняется количествами:
ordered=open+reservedStorage+reservedShipping+shipped+cancelled. Сборка переносит stock
и active allocation вместе, shipment потребляет их вместе. Release возвращает количество
в open и **не равен отмене** заказа; только явная отмена увеличивает cancelled.
Исторически released может быть позже зарезервировано заново новым основанием, но в
текущий reserved входят лишь active части. consumed и released закрытого резерва не
переписываются ради нового исполнения. Статусы и closed_mixed остаются проектными.

Существующие quantity int4, ReceivingPosted 1..1000 строк/256 КиБ и HTTP body limit
подтверждены по исходным схемам/коду. Для новых order/shipment предложены отдельные
лимиты, они не объявлены частью работающего контракта. [Draft контрактов](contracts/fulfillment.md),
[числовые AC и Mermaid](flows/fulfillment.md). Для будущих операций нужны новые
миграции/контракты; существующие SQL/ReceivingPosted v1 здесь не меняются.

## Размещение WMS-203

PutawayTask выполняется целиком receiving → storage того же склада. Количество/источник
определяет task, оператор выбирает target. Balance available=onHand-reserved должен покрывать
quantity; reserved сохраняется в исходной ячейке. Межскладской/произвольный перенос,
partial/cancel и перенос активного allocation не реализованы. Два movements, audit, task completed,
PutawayCompleted и HTTP result фиксируются атомарно; общий stock не меняется.
Pending → completed однократно, основание/creation audit immutable. Новый key на completed
отклоняется; исходный replay не переносит товар повторно. [Исполнение](flows/putaway-execution.md).

## WMS-204: работающий резерв

Fulfillment хранит immutable состав draft заказа, confirm делает active без stock эффекта.
Inventory хранит allocations и меняет reserved; physical onHand/movements при reserve/release
не меняются. Явный частичный reserve разрешён, нехватка вектора откатывает всю команду.
Release возвращает количество в open, cancel до сборки освобождает всё и закрывает заказ.
Allocated=active+released, line active<=ordered, managed balance reserved=SUM(active).
No TTL по B4. Picking/shipping и consumed — последующие задачи. [Flow](flows/reservations.md).
