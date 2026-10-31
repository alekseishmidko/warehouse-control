# 0022. Заказ и явное резервирование WMS-204

- Дата: 2026-10-31.
- Статус: Accepted пользователем; реализовано WMS-204.
- Уточняет WMS-201, ADR-0019 и транзакционные гарантии ADR-0009/0021.

## Согласованное решение

Заказ принадлежит одному складу, содержит 1..1000 уникальных productId.
Количество каждой строки — целые штуки 1..2147483647. HTTP body limit остаётся
262144 bytes. Состав draft фиксируется командой подтверждения: draft → active.
Резервирование доступно только active. Подтверждение не резервирует автоматически.

Клиент резервирует явное количество каждой выбранной строки. Заказ на 10 можно
обеспечить командой на 6, оставив open=4. Если команда запрашивает 10, а доступно 6,
вся команда откатывается. Сервер не уменьшает запрос молча и не фиксирует часть
многострочной команды при нехватке одной строки.

Fulfillment владеет orders/order_lines и оркестрирует общий transaction context.
Inventory владеет allocations и единолично изменяет stock_balances.reserved.
Межмодульные вызовы идут через экспортируемые сервисы, repository остаётся private.

## Блокировки и подбор

Порядок: server session/warehouse authorization, idempotency claim, order FOR UPDATE,
пригодные storage balances в стабильном порядке productId/locationId. Receiving и
shipping не участвуют в подборе. FIFO не обещается: партии и возраст stock не моделируются.
SKIP LOCKED для обычного резервирования не используется: ожидание конкурентного
владельца не должно выглядеть отсутствием товара. После ожидания locks available
перечитывается; значения до блокировки не используются для арифметики.

Кандидат может исчезнуть из available после конкурирующего commit: это штатный
недостаток, а не основание создать отрицательный reserve. Частичный reserve запроса
не выполняется. Конкурирующий приход в ранее отсутствующий balance не обязан попасть
в уже начатый подбор; retry новой команды может увидеть его.

## Allocations, release и отмена

Allocation связывает строку заказа с конкретным balance, хранит исходное, активное и
освобождённое количество. В WMS-204 consumed=0; shipment consumption добавляется позже.
Повторный reserve после release создаёт новое основание, не возвращает закрытую запись
в active и не стирает историю. SQL должен сохранять allocated=active+released+consumed.

Release указывает allocationId и положительное quantity <= active. Он уменьшает active
и reserved атомарно, не меняет onHand и не создаёт физического movement. Освобождённое
количество возвращается в open заказа. Заказ остаётся active. Cancel до сборки освобождает
все allocations, помечает весь неисполненный остаток cancelled и завершает заказ cancelled.
Прямой release shipping и отмена отгруженного в этот этап не входят. В WMS-205/206
появятся отдельные переходы staged/consumed и физический возврат согласно B3.

## API, права и события

Создание/подтверждение — order, чтение — read, reserve — reserve,
release/cancel — cancel на фактическом складе объекта. System admin без warehouse grants
не получает этих прав. Во всех командах session/CSRF и Idempotency-Key; ACL перечитывается
до saved replay. GET возвращает текущее состояние, replay — исходный commit snapshot.

Order aggregate и его sequence принадлежат fulfillment. Перед первым producer нужно
добавить source JSON Schemas, примеры, registry/KnownEvent, generation и SQL CHECK aggregate.
Audit, order state, allocations, reserved, outbox и saved result имеют один commit.
Consumers нового aggregate пока не требуются; retained факт без delivery не означает
выполненный внешний эффект. Новая подписка требует replay/start-position плана.

## Инварианты и обязательные проверки

- Для balance: 0 <= reserved <= onHand, reserved = SUM(active allocations).
- Для строки: ordered = open + reservedStorage + reservedShipping + shipped + cancelled.
- Резерв только storage своего склада и правильного SKU; нет избыточного покрытия строки.
- Два заказа на последнюю штуку: один успех, второй недостаток, без отрицательных значений.
- Несколько ячеек, явная частичная обеспеченность и полный rollback недостаточной команды.
- Reserve/release/cancel сериализуются на order и согласованном порядке balances.
- Fault injection после allocation/balance/audit/outbox/result не оставляет частичного состояния.
- Same-key retry не дублирует reserve/release; другой payload прежнего key даёт конфликт.
- После revoke прав replay не возвращает сохранённый результат.
- SQL reconciliation проверяется на реальной PostgreSQL с реальными migrations.

B4 сохраняется: нет expiresAt, TTL, cron или автоматического expiration. Будущие picking,
shipping и контроль сомнительного физического остатка не объявляются реализованными.

## Статус исполнения

WMS-204 реализована: orders/order_lines/stock_allocations, API, shared transaction context,
immutable allocation audit и OrderChanged v1. Consumers пока нет. Реальные PostgreSQL tests
проверяют конкуренцию, rollback, permissions и reconciliation. Модель WMS-204 использует
allocated=active+released (consumed появится с shipment). Будущие staged переходы не добавлены.
[Flow](../flows/reservations.md), [отчёт](../reports/wms-204.md).
