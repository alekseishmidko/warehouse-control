# 0016. Durable putaway handler и уникальная связь задания с приёмкой

- Дата: 2026-10-26
- Статус: Accepted
- Уточняет ADR-0010/0014/0015; transaction/outbox guarantees сохраняются.

## Решение

ReceivingPostedHandler регистрируется в worker composition root как inventory.putaway.
API его не запускает. Handler вызывает публичный InventoryService.createPutawayTasks;
локальные PutawayService/PutawayRepository остаются внутренними providers inventory.
Новых обязательных architectural layers, repositories других модулей и nested run нет.

PutawayTask — одна pending задача на receipt line: UUID id, sourceReceiptId/LineId/EventId,
warehouseId/sourceLocationId/productId/quantity, auditId, createdAt. Это ожидание физического
размещения, не резерв, перемещение или начисление. Target location, execution/cancel и HTTP API
заданий пока отсутствуют. Таблица immutable/retained для runtime, DBA может обойти guard.

Global unique sourceReceiptLineId запрещает вторую задачу по другому event; дополнительный
unique(eventId,lineId) явно выражает origin key. Composite FK с receiving защищают принадлежность
строки, product/quantity, warehouse/location и posted event. Receiving-owned unique keys
добавляются отдельной новой generated migration **до** таблицы tasks/FK; старые SQL не меняются.
Schema imports FK не являются прямыми записями в чужие таблицы. Repositories читают свои таблицы.

Worker удерживает stream locks, проверяет consumer marker и передаёт один context.
Handler использует server system actor UUID, correlationId исходного event и reason receipt-posted.
Inventory проверяет schema snapshot, aggregateId=payload.receiptId и уникальность строк/товаров,
создаёт task audit и task. Task/audit/marker/cursors/completion имеют один COMMIT B worker.
Нового stock movement/outbox event при планировании не создаётся. Ошибка любого шага откатывает
весь результат consumer; уже подтверждённая приёмка сохраняется.

Одинаковая immutable task на прямом inventory repeat возвращается без нового audit. Конфликт
source event/quantity/ref — permanent HANDLER_REJECTED либо DATABASE_REJECTED, не silent no-op.
Отсутствующую task SELECT не блокирует: при прямой гонке INSERT unique constraint откатывает
проигравшую transaction вместе с её audit. Ошибку нельзя подавлять внутри callback. В обычном
worker одинаковые delivery дополнительно сериализуются stream lock и processed marker.

Consumer подписан на полный receipt stream по stable destination, без фильтра claim по type.
Известные, но неинтересные типы должны возвращать no-op, worker пишет marker/cursor. Сейчас
KnownEvent содержит только ReceivingPosted v1; будущая routing ветка проверена unit surrogate,
она не делает неизвестные типы/версии валидными. Worker по-прежнему паркует их в dead до handler.

## Альтернативы и последствия

- Handler снова вызывает receive: удваивает остаток и нарушает ownership сценария — запрещено.
- Только processed marker: не защищает прямой inventory call или новый fact для той же line.
- ON CONFLICT DO NOTHING после audit: мог бы оставить orphan audit и скрыть разные основания.
- Отдельный COMMIT task: crash перед marker допускает частичный consumer result.
- Lookup чужих receipt tables в inventory repository: нарушает границы. Composite FK дают
  нужную relational защиту без межмодульного чтения; полноту published fact обеспечивает receiving.

Введены дополнительные unique indexes и FK, миграции применяются migration owner и могут
блокировать запись при DDL; zero-downtime на внешнем стенде не заявляется. Pending tasks накапливаются
до будущего выполнения размещения. Нет exactly once, automatic admin replay, UI и новой event schema.
Identity consumer/system actor стабилен и не является credential. Подробности:
[флоу](../flows/putaway.md), [inventory](../../apps/backend/src/modules/inventory/README.md).

Источники: [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html),
[CREATE TABLE / composite FK](https://www.postgresql.org/docs/17/sql-createtable.html).
