# Transaction contracts

Контракт атомарного сценария WMS-103, используемый сервисами модулей и audit.

## Для менеджера

Изменение данных и запись истории либо сохраняются вместе, либо откатываются.
Общий context используется receiving, putaway, fulfillment и durable worker; реальные SQL tests
проверяют атомарность stock/audit/outbox, rollback и конкуренцию.

## Для разработчика

`transaction.port.ts`: opaque TransactionContext, TransactionRunner.run и TRANSACTION_RUNNER token.
Port не содержит ORM handle, HTTP/Kafka, commit/rollback методов или автоматического retry.
Операция run принадлежит orchestrator; вызываемые сервисы принимают уже полученный context.
После callback context недействителен. Все эффекты внутри callback должны быть awaited.

Реализация — infrastructure/database/postgres-transaction-runner.ts; она проверяет
scope и запрещает nested run. Собственных таблиц, конфигурации, endpoints и событий нет.
Контракт и retry policy: [transactions](../../../../../docs/transactions.md).
Проверки: `pnpm test:integration` и `pnpm typecheck`; примеры — transactions-audit.spec.ts.
