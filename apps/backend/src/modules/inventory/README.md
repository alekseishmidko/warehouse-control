# Inventory module

Минимальный учёт WMS-104: StockBalance и immutable StockMovement, внутреннее начисление.

## Для менеджера

Inventory — единственный владелец изменения остатков. Начисление добавляет товар
в приёмочную ячейку и одновременно сохраняет audit и движение с основанием.
Количество только в целых штуках: максимум 2147483647 на один остаток.
Два одновременных прихода не теряют количество. Повтор того же operationId
отклоняется без дополнительного начисления; прежний результат автоматически не возвращается.

Нет публичного CRUD, документа приёмки, размещения, резервирования, отгрузки,
HTTP idempotency или outbox. Dev fixtures создают только справочники, не остатки.
DBA способен менять БД: append-only не является криптографической защитой.

## Файлы и интерфейсы

| Файл | Назначение |
|---|---|
| inventory.module.ts | Экспорт InventoryService, imports сервисов catalog/warehouses/audit |
| services/inventory.service.ts | receive(context,DTO) и getBalance(context,key) |
| repositories/inventory.repository.ts | Guarded upsert, appendMovement и чтение собственного balance |
| dto/stock.dto.ts | StockKeyDto, ReceiveStockDto, StockBalanceDto, ReceiveStockResultDto |
| inventory.schema.ts | int4, unique/FK/CHECK, movement с audit link и operationId unique |

Repository не экспортируется. Сервис получает только публичные сервисы других
модулей и не пишет в их таблицы. Schema может ссылаться на чужие schema для FK —
это описание ограничений, не обход владельца при записи.

## Движение данных

```mermaid
sequenceDiagram
    participant Caller as Владелец TransactionRunner.run
    participant Service as InventoryService
    participant Catalog as CatalogService
    participant Warehouses as WarehousesService
    participant Repo as InventoryRepository
    participant Audit as AuditService
    participant DB as PostgreSQL
    Caller->>Service: receive(context, ReceiveStockDto)
    Service->>Service: quantity 1..MAX, operationId UUID
    Service->>Catalog: requireProduct(context, productId)
    Catalog-->>Service: ProductDto
    Service->>Warehouses: requireLocation(context, warehouseId, locationId)
    Warehouses-->>Service: LocationDto
    Service->>Service: kind должен быть receiving
    Service->>Repo: credit(context, input)
    Repo->>DB: INSERT ON CONFLICT UPDATE с overflow guard
    DB-->>Service: StockBalanceDto
    Service->>Audit: stock-received, before/after onHand, identifiers
    Audit->>DB: INSERT audit_entries
    Audit-->>Service: auditId
    Service->>Repo: appendMovement(context, input, auditId)
    Repo->>DB: INSERT stock_movements, unique operationId
    Repo-->>Service: movementId
    Service-->>Caller: balance, movementId, auditId до commit
    Note over Caller,DB: COMMIT после всего callback; любое исключение вызывает ROLLBACK
```

Input — внутренний DTO: warehouseId/locationId/productId, quantity, operationId,
actorType/actorId/correlationId/reasonCode. Context — отдельный argument, не часть
JSON и не DB client. Trusted metadata берётся от вызывающего сервиса, не public body.

Пример (все UUID условные): ключ склада/приёмочной ячейки/товара, quantity=10,
новый operationId и reasonCode=dev-receipt → balance {id, те же ключи, onHand:10,
reserved:0} + audit {action:inventory.stock-received, onHand:0→10} + движение
{kind:receipt, quantity:10, operationId, auditId}. receive возвращает
{balance, movementId, auditId}; createdAt движения создаёт PostgreSQL.
Внешний успех разрешён только после await runner.run, не после одного INSERT.

getBalance: проверка product и ownership location → SELECT balance по тройке →
StockBalanceDto либо null. Это внутреннее чтение, не публичный API или auth policy.

## Транзакции, конкуренция и ошибки

- Один context на balance, audit и movement; service/repository не начинают run.
- Upsert по (warehouseId,locationId,productId) сериализует competing writers.
  Проверка onHand <= MAX-quantity выполняется до addition; stale read в JavaScript нет.
- reserved не изменяется начислением. Новая строка получает 0; CHECK сохраняет
  0 <= reserved <= onHand. Reservations/allocations появятся отдельной задачей.
- operationId уникален на одно движение/строку. Duplicate INSERT откатывает ранее
  выполненные в этой транзакции credit/audit. Это reject-on-repeat, не HTTP dedup.
- Missing product, неверный UUID, чужая/отсутствующая location или не receiving kind
  отклоняются до upsert. Валидация quantity не приводит строки к числу.
- Overflow, invalid audit, movement unique/FK или последующая ошибка вызывающего
  callback откатывают весь приход. Ошибки нельзя ловить и игнорировать внутри run.
- SQL constraints защищают scope баланса даже при обходе сервиса. Назначение receiving
  проверяет сервис, SQL FK сам по себе не проверяет kind.

Движения защищены grants SELECT/INSERT и триггером UPDATE/DELETE/TRUNCATE.
Runtime не может отключить trigger; owner/admin способен намеренно обойти защиту.
Прямой SQL баланс/движение из других модулей запрещён. Outbox пока не пишется:
он добавится WMS-106 в эту же транзакцию до появления реальных документов приёмки.

## Проверки и эксплуатация

pnpm test:unit / test:integration / typecheck. Реальная БД:
[stock.spec.ts](../../../test/integration/stock.spec.ts) проверяет barrier-синхронизированную
гонку отсутствующего balance, overflow, duplicate operation, FK/unique/CHECK,
неверные quantity/location и полный rollback. Unit
[stock-quantity.spec.ts](../../../test/unit/stock-quantity.spec.ts) сверяет диапазон
с draft JSON Schema; полноценная runtime JSON Schema validation реализована
в WMS-105 в [shared/events](../../shared/events/README.md). Inventory сам событий не публикует.

DATABASE_URL общий, специальных переменных/метрик/events нет. Миграции 0003/0004:
pnpm db:migrate. Fixture CLI pnpm db:seed не начисляет stock. Runbook outbox пока
не применим к восстановлению balance; исправлять journal прямым UPDATE нельзя.
[Модели/контракт](../../../../../docs/stock-baseline.md),
[транзакции](../../../../../docs/transactions.md), [ADR-0010](../../../../../docs/adr/0010-minimal-stock.md).
