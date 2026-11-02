# 0024. Отгрузка и подтверждённый возврат при отмене

- Дата: 2026-11-03.
- Статус: Accepted как реализация порученного WMS-206 в границах принятых B1–B4.
- Уточняет ADR-0022/0023. Временный отказ отмены собранного из WMS-205 заменяется B3-флоу.

## Решение

Shipment — отдельный immutable документ выбранной staged партии одного заказа.
Есть draft, posted, cancelled; частично проведённого документа нет. Несколько draft
не резервируют товар повторно. Каждый posting перепроверяет active shipping и stock
под order/header/balance locks. Право ship требуется для подготовки, posting и отмены draft.
Отмена draft не отменяет заказ. Терминальный shipment не переоткрывается.

Allocation учитывает consumed: allocated=active+released+transferred+consumed.
Проведение уменьшает shipping onHand/reserved и active, увеличивает consumed.
У каждой строки shipment одно уникальное основание списания. Новое reserve не может
повторно обеспечить уже consumed количество. Полностью отгруженный заказ — completed.

Запрос отмены с staged переводит заказ в cancel_pending и сохраняет весь резерв.
Order lock сериализует cancel с pick/ship/reserve. Подтверждение физического возврата
требует return, полный вектор и reasonCode. Оператор сначала физически перемещает товар,
затем выполняет короткую DB-команду; БД не удерживает locks во время действий человека.
При ошибке команда откатывает учёт, а физическое расхождение требует сверки.

Вектор возврата содержит по одной записи на каждую order line с active shipping:
lineId, точное полное количество и storage target своего склада. Сервер раскрывает
его во все исходные shipping allocations. Поэтому лимит 1000 order lines не требует
бесконечного client-вектора при многократных частичных сборках. Источники видны в GET
через locationId allocations. Произвольные partial-компенсации не предоставлены.

Возврат переносит onHand shipping → storage, уменьшает shipping reserved/active и
увеличивает released. Нового резерва storage не создаёт. Storage резервы того же заказа
освобождаются в том же commit. Незавершённые picking tasks отменяются, pickedTotal
сохраняется. Без отгруженного заказ становится cancelled. Если часть отгружена,
закрывается только остаток: status closed_mixed, shipped сохраняется.

## Объём компенсаций

Реализуется только согласованный B3: возврат неотгруженного staged товара в хранение
при отмене. Автоматическое списание shortage, произвольная корректировка остатков и
возврат от клиента уже shipped товара не утверждены и не добавляются. B4 по-прежнему
исключает автоматический expiration. Нет Redis, новой очереди или отдельного процесса.

## Надёжность и контракты

Fulfillment владеет documents/cancellation, inventory — stock/reservations/movements.
Order → shipment → все balances в порядке product/location. Идемпотентность, сессии,
ACL, аудит и outbox используют прежние компоненты. Все изменения и saved HTTP result
фиксируются одним commit. Вызывающий не подавляет ошибки inventory/audit/SQL.

ShippingEffects — immutable основания ship/return. Movement.shippingEffectId отдельный
от прежних putaway/picking оснований. Unique(effectId,kind), FK, CHECK и deferred guards
сверяют документы, allocations, consumed/released и движение/пару. Возврат требует
закрытия отмены в том же commit; отдельная запись эффекта не завершает компенсацию.
Защита не распространяется на администратора БД.

ShippingChanged v1 — новое имя события в существующем order stream. OrderChanged v1
и PickingProgressed v1 не расширяются несовместимыми enum. Новых consumers нет.
HTTP body и envelope остаются <=262144 UTF-8 bytes, документы 1..1000 строк.
Разные UUID нормализуются до cache, unknown DTO fields отклоняются. API v1 существующих
заказов получает новые состояния и consumed/locationId/state allocations; generated
OpenAPI и документация изменяются вместе. Внешних опубликованных клиентов пока нет.

[Исполнение и evidence](../flows/shipping.md), [отчёт](../reports/wms-206.md).

Уточнение исполнения по review: новый guard 0031 закрывает поздний INSERT в состав
закоммиченного shipment draft. Создание header/lines остаётся одной транзакцией.
ShippingChanged conditional schema требует ID конкретного shipment для его действий,
но не для отмены заказа. Это исправления исходного контракта, не новые бизнес-права.
