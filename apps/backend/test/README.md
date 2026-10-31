# Тестовая инфраструктура backend

WMS-102: Jest unit/integration projects, Supertest и PostgreSQL Testcontainers.
Для менеджера: проверки подтверждают изоляцию данных, commit/rollback, работу
технического HTTP и освобождение ресурсов при ошибке. Полная приёмка ещё не реализована;
проверки внутреннего stock baseline и контрактов описаны в разделах WMS-104/105 ниже.

## Команды из корня

```sh
pnpm test:unit        # без Docker: runtime configuration и startup failure
pnpm test:integration # реальные временные PostgreSQL containers, нужен Docker
pnpm test            # оба проекта, максимум два Jest workers
pnpm test:config     # совместимый alias test:unit
pnpm typecheck       # production source и TypeScript tests
```

Команды test/test:unit/test:integration выполняют test:prepare: проверяют generation
контрактов (contracts:check), собирают backend,
удаляют старый .test-dist и компилируют tests через tsconfig.test.json.
Jest читает compiled tests; @backend/* отображается в настоящий production dist,
поэтому тесты не исполняют вторую копию приложения из test output.
Без --passWithNoTests и --forceExit: пустая suite или незакрытые ресурсы не скрываются.
Не запускать одновременно несколько test:prepare в одном checkout: они очищают output.
Параллельность поддерживается между suites внутри одного Jest-прогона.

## Файлы

| Файл / каталог                         | Назначение                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------- |
| ../jest.config.cjs                     | Два projects с отдельными testMatch, maxWorkers=2, Node environment        |
| ../tsconfig.test.json                  | TS aliases/types и compiled output .test-dist; source/tests typecheck      |
| integration.setup.cjs                  | 120 секунд для integration tests/hooks                                     |
| unit/audit-entry.spec.ts               | Audit validation и redaction без БД                                        |
| integration/transactions-audit.spec.ts | Общий context, audit atomicity, rollback, scopes и права PostgreSQL        |
| support/audit.fixture.ts               | Синтетические audit IDs/коды                                               |
| unit/environment.spec.ts               | Строгая конфигурация и redaction, без БД                                   |
| integration/database.spec.ts           | Реальные SQL migrations, commit/rollback и очистка                         |
| integration/http.spec.ts               | Настоящий AppModule и Supertest, закрытие app pool                         |
| integration/lifecycle.spec.ts          | Cleanup после assertion failure и две независимые БД с одинаковыми ключами |
| support/database-harness.ts            | Жизненный цикл БД/приложения, migrations и cleanup                         |
| support/metadata.fixture.ts            | Уникальная техническая metadata-запись без бизнес-логики                   |
| database-baseline.test.cjs             | Сохранённая native WMS-101 проверка Compose restart, вне Jest testMatch    |

## Docker prerequisites

Нужны работающий Docker-compatible daemon, доступ к его socket и registry для
первой загрузки PostgreSQL и Ryuk. Docker Desktop arm64 проверен локально.
Compose запускать **не нужно**: harness не использует .env, dev DATABASE_URL,
фиксированный host port или dev volume. Он читает только PostgreSQL image из
infra/compose/compose.yaml, поэтому major/patch/digest совпадают с dev-стендом.
Собственные переменные DOCKER_HOST/TLS и socket override настраиваются по
[официальной инструкции runtime](https://node.testcontainers.org/supported-container-runtimes/).
Не отключать Ryuk ради обхода ошибок без отдельного плана уборки ресурсов.

## Изоляция и lifecycle

Отдельный container и случайное имя БД на suite. Порты динамические, credentials
случайные. Миграции применяются Drizzle migrator из backend/drizzle, ORM auto-sync нет.
После каждого теста очищаются metadata/audit и все WMS-104 stock/reference tables,
journal не трогается.
Для reset администратор disposable container временно отключает audit/movement
append-only triggers внутри транзакции и включает их обратно; runtime-группе это запрещено.
При добавлении таблиц обновлять reset с учётом FK; не запускать test.concurrent
на одном harness. Для concurrent сценария создавать собственные harnesses.
Данные другого suite или dev Compose не очищаются.

Startup PostgreSQL ограничен 60 секундами, suite hook/test — 120 секундами.
Cleanup каждого ресурса ограничен 15 секундами, container stop — 10 секундами,
afterAll — 60 секундами. Сначала закрываются HTTP/Nest, затем pool, затем container.
Ошибки cleanup приводят к провалу; timeout не считается доказательством освобождения.
Если runner аварийно убит, Ryuk — дополнительная страховка, не замена finally.
Холодная загрузка images зависит от registry и сети; при timeout диагностировать
причину, не увеличивать лимит бесконтрольно и не добавлять skip.

## Fixtures и новые suites

Общий test-only код находится в support, не в production shared.
Fixture создаёт уникальные технические значения; не повторяет доменные правила.
Для обычной suite вызвать useDatabaseSuite на верхнем уровне, получить harness
в тесте, использовать экспортируемые сервисы и repositories своего модуля. Для проверки отказов
использовать withDatabaseHarness: finally освобождает ресурсы после callback throw.
Config Nest заменяется через DATABASE_CONFIG provider, process.env не изменяется.
Регистрацию app cleanup выполняем до app.init, чтобы ошибка init также убиралась.

## Если Docker недоступен

Integration setup бросает явную ошибку; Jest выходит с ненулевым кодом.
Нет fallback на localhost, in-memory mock или успешный skip. Unit tests остаются
доступны отдельно. Проверено также при запрете доступа к Docker socket.

Диагностика: docker version/info, Docker context, registry/network и доступ к socket.
При необходимости DEBUG=testcontainers* использовать локально и проверять вывод
перед публикацией: подробные логи могут содержать настройки окружения.
Остатки контейнеров проверять только по label warehouse-controller.test=integration;
не применять Docker-wide prune и не удалять чужие контейнеры.

## Отдельная проверка WMS-101

pnpm test:db-baseline требует **dev Compose**, перезапускает postgres проекта,
не входит в pnpm test и не предназначена для параллельного запуска с API.
См. [Compose](../../../infra/compose/README.md). Не путать её с изолированными integration suites.

WMS-103 проверяет роль warehouse_app через SET LOCAL ROLE и обычный SQL владельца.
Это не provisioning production login. Правила атомарности, masking и retry —
[transactions](../../../docs/transactions.md). Контекст передаётся явно; новые
application tests используют PostgresTransactionRunner, не второй framework.

## WMS-104

unit/stock-quantity.spec.ts сверяет SQL/service/audit/draft schema quantity boundary,
нормализацию и запрет dev CLI вне development. integration/stock.spec.ts проверяет
реальные модели, grants, FK/unique/CHECK, guarded credit/movement/audit, concurrent
absent key с barrier, overflow и dev CLI на disposable DB.
Fixture builder переиспользуется из production infrastructure, не дублируется тестами.
Reset включает products/warehouses/locations/balances/movements; owner отключает
оба append-only triggers только в рамках admin cleanup transaction.

## WMS-105

unit/event-contracts.spec.ts проверяет production EventContracts на входах
prepareForOutbox/parseForHandler: исходный ReceivingPosted и отдельные fixtures,
полный envelope/payload, UUID/date-time, UTC Z, quantity int4, обязательные поля,
unknown fields/version, line limit и точный UTF-8 byte limit.
unit/event-generation.spec.ts запускает generator отдельным Node process (Prettier
использует ESM), проверяет воспроизводимость и missing/stale TS/schema artifacts
в disposable temporary directory с cleanup в finally. Checkout не изменяется.
Команды из корня: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm test:unit`.
Docker для контрактных unit tests не нужен; реальный outbox writer integration добавлен WMS-106; handler пока нет. Schemas и fixtures описаны в [contracts](../../../docs/contracts/README.md).

## WMS-106

integration/outbox.spec.ts проверяет реальный OutboxService из Nest AppModule:
commit/rollback с inventory/audit, невидимость до commit, сбой INSERT delivery,
повтор migrations, уникальность eventId/aggregateVersion/delivery/stream, FK/CHECK,
конкурентный absent counter, pg_blocking_pids для ожидания lock, rollback/reuse version
и независимый агрегат. Падение соединения до commit воспроизводится pg_terminate_backend
только в disposable DB, затем проверяется новая успешная запись с версией 1.
Также покрыты stale/forged contexts, UUID case, final bytes/version bounds,
права warehouse_app и immutable/retention triggers владельца. Worker ещё не реализован,
поэтому redelivery/claim/crash recovery после claim остаются WMS-109/110.

support/outbox.fixture.ts загружает source example до транзакций, создаёт независимые
AppendEventDto без генерации бизнес-эффектов. Reset отключает четыре outbox triggers
и включает обратно внутри admin cleanup transaction только в suite container;
исходный migration journal и dev Compose не трогает. Fault trigger удаляется finally.
Команда: pnpm test (Docker обязателен для integration, skip/fallback отсутствуют).

## WMS-107

unit/http-foundation.spec.ts проверяет canonical JSON, циклы/getters/non-JSON и fail-closed
runtime config actor. integration/http-commands.spec.ts использует настоящий loopback HTTP
listener, global guard/pipe/filter, PostgreSQL storage и callback с metadata/audit/outbox.
Проверяет normalized replay, concurrent winner/conflict, rollback/waiter takeover, клиентский
deadline и retry, изоляцию scope/target/actor, JSON null result, denied dev modes/headers,
malformed/oversized JSON, safe problems и runtime grants/immutable result.

support/http-command.fixture.ts содержит DTO/probe/controller только тестов. Harness
принимает optional controllers/imports/providers/config и вызывает общий configureHttp до
init; env не меняется. Source AppModule/OpenAPI не импортируют тестовый controller.
Reset отключает http_idempotency_retained только в disposable DB, затем включает обратно.
OpenAPI diff добавлен test:prepare после build, offline generation работает без Docker/БД.
Client timeout не закрывает listener suite (Supertest ephemeral server здесь не подходит).
Команда pnpm test, unit отдельно pnpm test:unit; no Docker integration skip/fallback.

## WMS-108

integration/receiving.spec.ts проверяет реальные production create/get/post routes:
10 принято = одно movement/event, replay/target conflict, quantity/limits/refs,
реальные parent/unique lock waits, winner rollback, разные документы, две строки,
overflow, SQL constraints/grants и отсутствие task table. SQL AFTER fault triggers
прерывают draft, balance, inventory audit/movement, receipt audit, counter/event/stream/
delivery, final status и HTTP result; каждый раз проверяются полный rollback и retry.
Triggers удаляются finally, harness сбрасывает receiving history только в disposable DB.
Документированный docs/examples/receiving-result.sql выполняется на happy path.
unit/receiving-examples.spec.ts валидирует HTTP fixture реальным DTO validator и
согласованность response/event examples. support/database-lock.ts переиспользуется
receiving и HTTP dedup suites: ожидание pg_blocking_pids с deadline 5 секунд.

## WMS-109

unit/worker-policy.spec.ts: validated config, equal jitter/caps, safe error allowlist,
permanent/transient classification и explicit registry. integration/worker.spec.ts:
реальные worker Nest/pg graphs, SKIP LOCKED, следующие версии, independent aggregates,
stale token, processing locks после expiry, marker redelivery, SQL AFTER faults каждого
существенного шага, budget/dead, неизвестный контракт, connection crash и runtime grants.
worker-process.spec.ts запускает actual child/production dist lifecycle: SIGTERM drain,
hard deadline, SIGKILL до/после commit, отсутствие новых claims/idle transactions.
Support worker-process.fixture.ts — test-only technical effect и IPC barriers, не бизнес-handler.
Harness createWorkerApplication регистрирует cleanup, config/handlers заменяются DI,
parent process.env не меняется. Child env изолирован, credentials не передаются в args/logs.

## WMS-110

putaway.spec.ts использует production registry без подмены handler: одна pending task/
audit/marker, cursors/completion и прежний stock/movement/event. Проверены worker same-token
locks, direct absent-key INSERT race, exact repeat/marker replay, malformed source/conflicting
new fact, multi-line rollback, SQL AFTER failures каждого существенного шага и warehouse_app.
worker-process.spec.ts дополнен actual production putaway SIGKILL до и после commit.
worker-process.fixture.ts в child mode TEST_PUTAWAY_HANDLER=true сохраняет production
registry и оборачивает реальный InventoryService только IPC barrier/commit notification.
Это test-only hook, не разрешение production I/O в handler. Старый technical handler mode
сохраняется для protocol tests. posted-receipt.fixture.ts вызывает реальные owners для refs/
draft/post без прямого stock SQL. Parent env не меняется, child config изолирован.
receiving-posted.handler.spec.ts проверяет server metadata/permanent mapping и будущую
known-uninteresting routing ветку; surrogate не добавлен в runtime registry.
Документированный putaway-result.sql выполняется в happy path.

## WMS-111

outbox-recovery.spec.ts integration проверяет production failure→dead→actual child CLI
inspect/signal/retry→одна task с прежним stock, operator/reason audit/history, новый budget
без reset attempts, role denial/admin group, live lease/NOWAIT locks, predecessor/marker
refusal, two operators и fault после каждого admin SQL шага. Safe payload/unknown errors,
old backlog/dead alert и int4 attempt limit также покрыты. Unit suite с тем же именем проверяет
strict parser/local guard/shared formatter и failing stdout sink. Parent env не меняется.
`pnpm outbox:recovery-check` запускает этот disposable runbook, Docker failure не skip.
Harness очищает recovery history только отключив immutable trigger внутри test admin transaction.

## Session identity WMS-202

Новые unit/integration identity.spec.ts проверяют настоящую session auth, CSRF, warehouse
roles, revoke до replay, last-admin race, SQL faults и compiled bootstrap. В identity.fixture.ts
прямые SQL только для синтетических users/session/grants; AuthGuard/ACL не подменяются.
Login-specific cases проходят реальный HTTP/scrypt. Runtime env не мутируется: IdentityConfig
переопределён DI короткими test-only сроками. Старого dev actor bypass нет.
Receiving posting race использует две сессии одного actor, чтобы наблюдать business lock;
отдельный identity test проверяет expiry после ожидания session lock (не только до него).

`pnpm format` / `pnpm format:check` — Prettier из корня monorepo; generated outputs, SQL
migrations и credentials исключены. `pnpm test` по-прежнему выполняет build/contract/OpenAPI
check и real PostgreSQL suites; formatter не заменяет проверки поведения.

## Проверка покрытия identity

`pnpm test:identity:coverage` из корня выполняет production build, event/OpenAPI diff,
компиляцию tests и обе Jest suites с настоящим PostgreSQL Testcontainers. Нужен Docker;
без Docker команда завершается ошибкой, skip/fallback нет. Config —
[jest.identity-coverage.config.cjs](../jest.identity-coverage.config.cjs).
HTML — apps/backend/coverage/identity/index.html, summary — coverage-summary.json рядом.
Coverage outputs игнорируются Git и Prettier, generated source не меняется.

IdentityController имеет обязательный порог 100% statements/branches/functions/lines;
Jest падает при снижении. Для остальных identity файлов отчёт диагностический:
bootstrap исполняется в compiled child CLI, его coverage не объединяется с parent Jest.
Нулевой parent coverage CLI не означает отсутствия bootstrap integration tests. Interfaces
и decorated DTO тоже могут давать технические V8 gaps; общий процент не заменяет проверку
реальных SQL locks, rollback и HTTP контрактов.

Новые unit файлы: identity.controller.spec.ts проверяет transport/ожидание service completion,
identity-http.spec.ts — principal/cookie/CSRF, auth.service.spec.ts — throttle/hash failure и
credential recheck. HTTP/SQL assertions, адресный revoke, role removal, все четыре warehouse
роли и logout AFTER UPDATE fault — в integration/identity.spec.ts. Там же остаются ранее
добавленные реальная гонка last admin, expiry lock, idempotency replay и bootstrap.

## WMS-203

integration/putaway-execution.spec.ts использует реальные receiving/worker/inventory/HTTP,
не прямое создание task. Проверяет одно/два задания, одинаковые/разные keys, absent target,
две одновременно наблюдаемые SQL waits (waitForDatabaseLock minimum=2), quantities/reserve,
foreign warehouse/roles/replay revoke и AFTER faults каждого шага. Direct SQL stock setup
только для constraints/fault scenarios disposable БД; incomplete pair проверяет deferred COMMIT.
Новый event schema/example проверяет unit/event-contracts.spec.ts, generated diff штатный.

## WMS-204 PostgreSQL

integration/reservations.spec.ts использует реальные receipt/worker/placement для stock setup,
HTTP session/ACL/idempotency и migrations 0022–0024. Проверяет два lock waits на последнюю штуку,
несколько ячеек, многострочный недостаток, explicit partial reserve, release/cancel/history,
reserve/release race, audit/outbox/allocated AFTER faults, managed mismatch 23514 и runtime grants.
DTO tests отдельно без Docker. Нельзя считать unit input validation доказательством ledger correctness.
