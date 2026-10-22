# Operation metadata

Общий внутренний DTO метаданных мутации, переиспользуемый справочниками, inventory и audit.

## Для менеджера

Позволяет связать действия с субъектом, основанием и одним сквозным сценарием.
Сам DTO не выполняет авторизацию и не подтверждает личность пользователя.

## Для разработчика

Файл dto/operation-metadata.dto.ts содержит actorType, actorId, correlationId, reasonCode.
Это TypeScript interface без runtime-логики. Проверки обязательных audit fields
выполняет AuditService; actor должен поступать из доверенного caller context.

```mermaid
flowchart LR
  Caller[Доверенный сервис] --> DTO[OperationMetadata]
  DTO --> Service[Catalog / Warehouses / Inventory]
  Service --> Audit[AuditService validation]
```

Пример: system actor UUID + correlation UUID + reasonCode=dev-fixture передаются
без преобразования; UUID/формат code проверяет audit перед INSERT. Неверный metadata
должен откатить текущий сценарий. DTO не содержит TransactionContext или credentials.
Собственных транзакций, env, events и методов нет; pnpm typecheck и integration/stock.spec.ts.


## Command scope WMS-107

В dto/command-scope.dto.ts добавлены CommandScope и CommandResult. Первый содержит
доверенные actorType/actorId, server operation, UUID key/correlationId; второй —
success 200/201/202 JSON body и optional relative Location. Это внутренние plain contracts,
не HTTP body DTO, не ORM models и не auth implementation. Guard → CommandScope →
HttpCommandsService → callback с TransactionContext → CommandResult → commit → HTTP.
Пример: operation=test.create/key=UUID и callback result={statusCode:201,body:{id:UUID}}
возвращаются после commit; replay пропускает callback. Ошибки/rollback и validation
описывают [idempotency](../../infrastructure/idempotency/README.md) и
[HTTP](../../infrastructure/http/README.md). Проверки integration/http-commands.spec.ts.
Новых I/O/env/своей transaction/retry у shared DTO нет.
