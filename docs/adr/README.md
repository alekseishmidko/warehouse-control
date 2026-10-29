# Architectural Decision Records

ADR фиксирует причину решения и его последствия. Accepted означает утверждённое
направление, не факт внедрения. Исторические решения не переписываются под новый выбор:
добавляется следующий ADR, прежний получает ссылку `Superseded by`.

| ADR                                             | Решение                                                                                               | Статус                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| [0001](0001-modular-monolith.md)                | Модульный монолит и pnpm                                                                              | Accepted                      |
| [0002](0002-postgresql-inventory.md)            | PostgreSQL, Drizzle и синхронный учёт                                                                 | Accepted                      |
| [0003](0003-outbox-before-kafka.md)             | Outbox перед Kafka                                                                                    | Accepted                      |
| [0004](0004-contracts.md)                       | OpenAPI и версионированные события                                                                    | Accepted                      |
| [0005](0005-platform.md)                        | Docker, Kubernetes, Nginx                                                                             | Accepted                      |
| [0006](0006-delivery-observability.md)          | Наблюдаемость и GitOps по этапам                                                                      | Accepted                      |
| [0007](0007-documentation-and-shared.md)        | Документация всех файлов и модулей, shared/DRY                                                        | Accepted                      |
| [0008](0008-transactions-and-audit.md)          | Явные транзакции, masking и append-only audit                                                         | Частично заменён 0009         |
| [0009](0009-nest-service-repository-default.md) | Controller → service → repository по умолчанию                                                        | Accepted                      |
| [0010](0010-minimal-stock.md)                   | Int4 quantity и минимальные stock модели/начисление                                                   | Accepted                      |
| [0011](0011-event-contract-validation.md)       | Ajv 2020-12, generation и пределы ReceivingPosted                                                     | Accepted                      |
| [0012](0012-outbox-writer.md)                   | Outbox writer, транзакционный counter и первоначальный destination                                    | Accepted                      |
| [0013](0013-http-idempotency.md)                | HTTP boundaries, isolated dev actor и atomic command response                                         | Accepted                      |
| [0014](0014-receiving-vertical-slice.md)        | Immutable состав приёмки, parent lock и атомарное проведение                                          | Accepted                      |
| [0015](0015-postgres-worker.md)                 | PostgreSQL worker: lease/token, атомарные markers/cursors и shutdown                                  | Accepted                      |
| [0016](0016-durable-putaway-handler.md)         | Pending PutawayTask, composite source FK и atomic durable handler                                     | Accepted                      |
| [0017](0017-local-outbox-recovery.md)           | Local inspect/retry/signal, operator audit/history и retry budget base                                | Accepted                      |
| [0018](0018-server-sessions.md)                 | Логин/пароль, серверные сессии и threat assumptions; матрица принята отдельно ADR-0019                | Accepted; реализовано WMS-202 |
| [0019](0019-warehouse-role-matrix.md)           | Роли/действия на конкретном складе; без автоматических складских прав system_admin                    | Accepted; реализовано WMS-202 |
| [0020](0020-session-implementation.md)          | Scrypt, cookie/CSRF, session/grants locks до replay, обязательная явная TTL policy                    | Accepted; реализовано WMS-202 |
| [0021](0021-putaway-execution.md)               | Полное размещение, стабильные balance locks, парные movements, task state и retained completion event | Accepted; WMS-203             |

Шаблон нового ADR: [template.md](template.md). Нумерация последовательная.
Рутинный implementation detail не требует ADR; изменение границ, гарантий,
транспорта, источника истины или платформы — требует.
