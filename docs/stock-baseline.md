# Минимальные складские данные WMS-104

Реализованный baseline моделей, количества и внутреннего начисления.
Публичный складской API, auth, документы приёмки и outbox пока отсутствуют.

## Модели и владельцы

| Модель / таблица | Минимальные поля | Владелец / интерфейс |
|---|---|---|
| Product / products | id UUID, unique normalized sku, name, unit=piece | CatalogService.create / requireProduct |
| Warehouse / warehouses | id UUID, unique code, name | WarehousesService.createWarehouse |
| Location / locations | id UUID, warehouseId FK, code, kind | WarehousesService.createLocation / requireLocation |
| StockBalance / stock_balances | id UUID, warehouseId/locationId/productId, onHand, reserved | InventoryService.receive / getBalance |
| StockMovement / stock_movements | id, unique operationId, stock key, kind=receipt, quantity, auditId, createdAt | Только InventoryService.receive |

Зоны представлены kind ячейки: receiving/storage/shipping. SKU глобально уникален,
так как организация одна. Codes нормализуются uppercase, names trimmed. Schema
владеет конкретный модуль, общий database/schema.ts лишь экспортирует их для Drizzle.
Все services/repositories/DTO размещены по отдельным папкам. Контроллеров нет.

## Количество

SQL integer (int4), JavaScript number: onHand/reserved 0..2147483647,
movement/приход 1..2147483647. Проверяется Number.isInteger без coercion и границы.
Дробные числа не принимаются сервисом. Сам SQL integer хранит целые значения;
PostgreSQL может явно/неявно приводить numeric expressions, поэтому входная проверка
обязательна и не заменяется одним типом колонки.

MAX_STOCK_QUANTITY — общий source constant в shared/quantities. Inventory SQL schema,
audit changes и service validation используют его; JSON Schema содержит то же
значение явно и проверяется contract-boundary unit test. WMS-105 добавила полноценный
schema validator и генерацию event types; [настройки и limits](contracts/README.md).

Draft receiving.receipt-posted v1.quantity.maximum сужен с MAX_SAFE_INTEGER до int4.
События ещё не публикуются, stored outbox/внешних consumers нет, поэтому уточнена
неопубликованная версия. После публикации такое сужение потребует новой major-версии.
AggregateVersion не является количеством и сохраняет собственный MAX_SAFE_INTEGER.

## Ограничения и атомарность

- UNIQUE SKU, warehouse code, (warehouseId,locationCode), stock key.
- Location имеет FK warehouse; balance composite FK (warehouseId,locationId)
  → Location(warehouseId,id) исключает привязку чужой ячейки к складу.
- Movement ссылается на stock key balance и обязательный auditId.
- CHECK 0 <= reserved <= onHand, onHand в int4; movement quantity >0 и kind=receipt.
- Только inventory меняет остатки. Другие модули вызывают его сервис.
- Guarded upsert увеличивает onHand в SQL и проверяет MAX-quantity до сложения.
  Две транзакции с отсутствующим ключом создают одну строку и сохраняют обе прибавки.
- Balance, audit и movement выполняются в одном context, commit принадлежит caller.
- operationId — UUID одного начисления/строки. Повтор отклоняется, а добавленная
  в неуспешной транзакции прибавка/audit откатывается. HTTP идемпотентность не реализована.

Warehouse/product сервисы также пишут audit в той же транзакции. Auth ещё нет:
вызов доступен только внутренним доверенным сценариям/CLI, не public CRUD.
Движения защищены append-only trigger и runtime grants SELECT/INSERT; balances —
SELECT/INSERT/UPDATE. Это не защита от owner/admin и не DB enforcement владельца модуля.
Placement/reservation/shipping/компенсации появятся отдельно; прямое исправление
movement не является допустимой коррекцией.

## Dev fixtures

```sh
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

CLI принимает только development (включая default среды из config), не test/production.
Перед подключением проверяет режим, затем в одном run создаёт новый товар,
склад и ячейки RECEIVING/STORAGE/SHIPPING через сервисы и audit. Stock не начисляется.
Каждый запуск создаёт **новый** набор с UUID suffix, не обновляет старые строки.
Вывод — только IDs, без credentials. Нужен connection из корневого .env после применения миграций.
Fixture builder переиспользуется тестами на disposable DB. API при этом не запускается,
CLI закрывает application context/pool в finally. Это инструмент dev, не migration seed.

## Движение данных

Внешний runner → InventoryService с DTO/context → CatalogService.requireProduct →
WarehousesService.requireLocation → validation receiving → repository guarded upsert →
AuditService → repository appendMovement → результат → commit/rollback runner.
Подробные sequence diagrams, DTO примеры и ошибки:
[catalog](../apps/backend/src/modules/catalog/README.md),
[warehouses](../apps/backend/src/modules/warehouses/README.md),
[inventory](../apps/backend/src/modules/inventory/README.md).

## Проверки и границы

pnpm test:unit, test:integration, test, typecheck. В integration обе транзакции
до barrier видят отсутствие balance, затем одновременно начисляют 2 и 3:
итог одна строка с 5 и два movements. Проверяются overflow, FK, unique, CHECK,
неверные input, rollback и immutable journal. Политика audit/TRX:
[transactions](transactions.md). Migrations 0003/0004 новые, старые не изменены.
Dev Compose не мигрируется автоматически при startup или запуске tests.

Источники: [PostgreSQL integer](https://www.postgresql.org/docs/17/datatype-numeric.html),
[PostgreSQL ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html),
[Drizzle guarded upsert](https://orm.drizzle.team/docs/guides/upsert).
