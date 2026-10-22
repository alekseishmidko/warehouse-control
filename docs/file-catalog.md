# Каталог файлов

Назначение каждого собственного файла проекта. Каталог обновляется вместе с добавлением,
перемещением или удалением файла. Подробности конфигурации backend — в
[README backend](../apps/backend/README.md), правила — в [стандарте](documentation-standard.md).
Зависимости, build output, IDE/cache, секреты и внутренние файлы Git не включаются.
Lockfile генерируется pnpm; исходные схемы и примеры редактируются вручную.

| Файл | Назначение |
|---|---|
| [.gitignore](../.gitignore) | Исключения зависимостей, сборки, секретов и IDE-файлов из Git. |
| [AGENTS.md](../AGENTS.md) | Контекст и правила для агента. |
| [README.md](../README.md) | Warehouse Controller. |
| [apps/backend/README.md](../apps/backend/README.md) | Backend Warehouse Controller. |
| [apps/backend/nest-cli.json](../apps/backend/nest-cli.json) | Nest CLI: sourceRoot src и deleteOutDir перед сборкой. |
| [apps/backend/package.json](../apps/backend/package.json) | Зависимости и команды backend; подробнее в apps/backend/README.md. |
| [apps/backend/src/app.controller.ts](../apps/backend/src/app.controller.ts) | Технические GET / и GET /health; проверка процесса без проверки БД. |
| [apps/backend/src/app.module.ts](../apps/backend/src/app.module.ts) | Корневой Nest module: технический HTTP, Database/Audit/Catalog/Warehouses/Inventory modules. |
| [apps/backend/src/app.service.ts](../apps/backend/src/app.service.ts) | Статическое приветствие API без I/O. |
| [apps/backend/src/main.ts](../apps/backend/src/main.ts) | HTTP bootstrap, validated config, shutdown hooks и безопасная ошибка запуска. |
| [apps/backend/tsconfig.build.json](../apps/backend/tsconfig.build.json) | Build-настройки: исключение тестов, зависимостей и dist. |
| [apps/backend/tsconfig.json](../apps/backend/tsconfig.json) | Наследование общего TS, decorators/metadata, rootDir src и outDir dist. |
| [docs/README.md](../docs/README.md) | Документация Warehouse Controller. |
| [docs/adr/0001-modular-monolith.md](../docs/adr/0001-modular-monolith.md) | 0001. Модульный монолит в pnpm workspace. |
| [docs/adr/0002-postgresql-inventory.md](../docs/adr/0002-postgresql-inventory.md) | 0002. PostgreSQL, Drizzle и синхронный учёт остатков. |
| [docs/adr/0003-outbox-before-kafka.md](../docs/adr/0003-outbox-before-kafka.md) | 0003. Transactional outbox сначала, Kafka затем. |
| [docs/adr/0004-contracts.md](../docs/adr/0004-contracts.md) | 0004. Явные контракты API и событий. |
| [docs/adr/0005-platform.md](../docs/adr/0005-platform.md) | 0005. Docker, Kubernetes и Nginx. |
| [docs/adr/0006-delivery-observability.md](../docs/adr/0006-delivery-observability.md) | 0006. Наблюдаемость и воспроизводимая поставка. |
| [docs/adr/0007-documentation-and-shared.md](../docs/adr/0007-documentation-and-shared.md) | 0007. Документация модулей и файлов, DRY и shared. |
| [docs/adr/README.md](../docs/adr/README.md) | Architectural Decision Records. |
| [docs/adr/template.md](../docs/adr/template.md) | NNNN. Название решения. |
| [docs/architecture.md](../docs/architecture.md) | Архитектура. |
| [docs/contracts/README.md](../docs/contracts/README.md) | Система контрактов. |
| [docs/contracts/events/receiving.receipt-posted.v1.schema.json](../docs/contracts/events/receiving.receipt-posted.v1.schema.json) | JSON Schema 2020-12 события приёмки v1; источник контракта, не generated output. |
| [docs/contracts/examples/receiving.receipt-posted.v1.json](../docs/contracts/examples/receiving.receipt-posted.v1.json) | Базовый валидный ReceivingPosted fixture; проверяется реальными runtime contract tests. |
| [docs/documentation-standard.md](../docs/documentation-standard.md) | Стандарт документации. |
| [docs/development-plan.md](../docs/development-plan.md) | План шести этапов: 38 задач и 217 шагов, зависимости, критерии приёмки и проверки. |
| [docs/domain.md](../docs/domain.md) | Домен и инварианты. |
| [docs/file-catalog.md](../docs/file-catalog.md) | Этот каталог: покрытие и назначение собственных файлов репозитория. |
| [docs/operations.md](../docs/operations.md) | Эксплуатация и поставка. |
| [docs/outbox.md](../docs/outbox.md) | Transactional outbox и доставка. |
| [docs/product.md](../docs/product.md) | Продукт и бизнес-процессы. |
| [docs/roadmap.md](../docs/roadmap.md) | Этапы реализации. |
| [docs/runbooks/event-recovery.md](../docs/runbooks/event-recovery.md) | Восстановление обработки событий. |
| [docs/shared.md](../docs/shared.md) | DRY и shared-слой. |
| [docs/templates/module.md](../docs/templates/module.md) | <Имя модуля>. |
| [package.json](../package.json) | Корневой workspace: закрепление pnpm, Node engines, dev/build/typecheck/start. |
| [pnpm-lock.yaml](../pnpm-lock.yaml) | Автоматический lockfile pnpm 10: регенерация pnpm install, проверка pnpm install --frozen-lockfile; вручную не редактировать. |
| [pnpm-workspace.yaml](../pnpm-workspace.yaml) | Границы apps/* и packages/*, разрешённый build hook NestJS. |
| [tsconfig.base.json](../tsconfig.base.json) | Общие strict TypeScript-настройки, ES2022, CommonJS и source maps. |
| [.env.example](../.env.example) | Публичные локальные env-настройки PostgreSQL/API; копируются в ignored .env. |
| [apps/backend/drizzle/0000_huge_robin_chapel.sql](../apps/backend/drizzle/0000_huge_robin_chapel.sql) | Generated baseline migration: application_metadata; generator pnpm db:generate, не менять после применения. |
| [apps/backend/drizzle/README.md](../apps/backend/drizzle/README.md) | Миграции WMS-101. |
| [apps/backend/drizzle/meta/0000_snapshot.json](../apps/backend/drizzle/meta/0000_snapshot.json) | Generated Drizzle snapshot первой схемы; регенерация db:generate, ручное редактирование запрещено. |
| [apps/backend/drizzle/meta/_journal.json](../apps/backend/drizzle/meta/_journal.json) | Generated journal migration tags/timestamps; обновляется db:generate. |
| [apps/backend/drizzle.config.ts](../apps/backend/drizzle.config.ts) | Drizzle Kit: dialect, schema/output пути, validated connection config. |
| [apps/backend/src/infrastructure/README.md](../apps/backend/src/infrastructure/README.md) | Инфраструктура backend. |
| [apps/backend/src/infrastructure/config/README.md](../apps/backend/src/infrastructure/config/README.md) | Конфигурация процесса. |
| [apps/backend/src/infrastructure/config/environment.ts](../apps/backend/src/infrastructure/config/environment.ts) | Optional root .env, strict NODE_ENV/PORT/DATABASE_URL validation без утечки credentials. |
| [apps/backend/src/infrastructure/database/README.md](../apps/backend/src/infrastructure/database/README.md) | PostgreSQL и Drizzle. |
| [apps/backend/src/infrastructure/database/check.ts](../apps/backend/src/infrastructure/database/check.ts) | Read-only CLI server_version/baseline table с закрытием pool. |
| [apps/backend/src/infrastructure/database/connection.ts](../apps/backend/src/infrastructure/database/connection.ts) | Общая pg Pool/Drizzle фабрика Nest и CLI; bounded pool, безопасные idle errors. |
| [apps/backend/src/infrastructure/database/database.module.ts](../apps/backend/src/infrastructure/database/database.module.ts) | Nest DatabaseModule/Service: config, startup/shutdown pool и TRANSACTION_RUNNER provider. |
| [apps/backend/src/infrastructure/database/migrate.ts](../apps/backend/src/infrastructure/database/migrate.ts) | Compiled CLI SQL migrations, journal, finally pool.end и безопасная ошибка. |
| [apps/backend/src/infrastructure/database/schema.ts](../apps/backend/src/infrastructure/database/schema.ts) | Агрегатор module-owned schemas metadata/audit/catalog/warehouses/inventory. |
| [apps/backend/test/README.md](../apps/backend/test/README.md) | Jest suites, Testcontainers, Docker prerequisites, cleanup и отдельный Compose smoke. |
| [apps/backend/test/database-baseline.test.cjs](../apps/backend/test/database-baseline.test.cjs) | Dev-only real PostgreSQL smoke: migrate twice, restart persistence и CLI termination. |
| [docs/reports/wms-101.md](../docs/reports/wms-101.md) | WMS-101: окружение и первая миграция. |
| [infra/compose/README.md](../infra/compose/README.md) | Локальный PostgreSQL. |
| [infra/compose/compose.yaml](../infra/compose/compose.yaml) | Закреплённый PostgreSQL 17.9, localhost port 15432, volume и healthcheck. |
| [apps/backend/jest.config.cjs](../apps/backend/jest.config.cjs) | Jest unit/integration projects, mapper на production dist, Node environment и maxWorkers=2. |
| [apps/backend/test/integration/database.spec.ts](../apps/backend/test/integration/database.spec.ts) | Реальная PostgreSQL: migrations, commit/rollback и очистка без удаления journal. |
| [apps/backend/test/integration/http.spec.ts](../apps/backend/test/integration/http.spec.ts) | Supertest настоящего Nest AppModule с отдельной БД; HTTP и закрытие app pool. |
| [apps/backend/test/integration/lifecycle.spec.ts](../apps/backend/test/integration/lifecycle.spec.ts) | Проверка cleanup после assertion failure и изоляция двух одновременно живых harnesses. |
| [apps/backend/test/integration.setup.cjs](../apps/backend/test/integration.setup.cjs) | Устанавливает 120 секунд на integration tests/hooks. |
| [apps/backend/test/support/README.md](../apps/backend/test/support/README.md) | Test support. |
| [apps/backend/test/support/database-harness.ts](../apps/backend/test/support/database-harness.ts) | Общий lifecycle Testcontainers PostgreSQL, migrations, Nest config override и cleanup ресурсов. |
| [apps/backend/test/support/metadata.fixture.ts](../apps/backend/test/support/metadata.fixture.ts) | Fixture технических metadata с уникальными значениями; без бизнес-логики. |
| [apps/backend/test/unit/environment.spec.ts](../apps/backend/test/unit/environment.spec.ts) | Jest unit: конфигурация, defaults, redaction и безопасный startup failure без Docker. |
| [apps/backend/tsconfig.test.json](../apps/backend/tsconfig.test.json) | TS types/aliases для tests, строгая компиляция в ignored .test-dist. |
| [docs/reports/wms-102.md](../docs/reports/wms-102.md) | WMS-102: тестовая инфраструктура. |
| [apps/backend/drizzle/0001_marvelous_ogun.sql](../apps/backend/drizzle/0001_marvelous_ogun.sql) | Generated audit schema migration: таблица/constraints/indexes; pnpm db:generate. |
| [apps/backend/drizzle/0002_audit-append-only.sql](../apps/backend/drizzle/0002_audit-append-only.sql) | Авторская custom migration: NOLOGIN runtime group, grants и append-only function/trigger. |
| [apps/backend/drizzle/meta/0001_snapshot.json](../apps/backend/drizzle/meta/0001_snapshot.json) | Generated Drizzle audit snapshot, ручное изменение запрещено. |
| [apps/backend/drizzle/meta/0002_snapshot.json](../apps/backend/drizzle/meta/0002_snapshot.json) | Generated snapshot custom migration scaffold; function/grants задаются авторским SQL. |
| [apps/backend/src/infrastructure/database/postgres-transaction-runner.ts](../apps/backend/src/infrastructure/database/postgres-transaction-runner.ts) | Drizzle runner, scoped WeakMap binding, nested-run guard и отзыв context без auto retry. |
| [apps/backend/src/modules/audit/README.md](../apps/backend/src/modules/audit/README.md) | Audit module. |
| [apps/backend/src/modules/audit/audit.module.ts](../apps/backend/src/modules/audit/audit.module.ts) | Nest AuditModule: private AuditRepository, экспорт AuditService. |
| [apps/backend/src/shared/README.md](../apps/backend/src/shared/README.md) | Shared backend. |
| [apps/backend/src/shared/transactions/README.md](../apps/backend/src/shared/transactions/README.md) | Transaction contracts. |
| [apps/backend/src/shared/transactions/transaction.port.ts](../apps/backend/src/shared/transactions/transaction.port.ts) | Opaque TransactionContext, TransactionRunner и DI token без транспорта/ORM. |
| [apps/backend/test/integration/transactions-audit.spec.ts](../apps/backend/test/integration/transactions-audit.spec.ts) | Реальная атомарность audit, rollback, context lifecycle/scope, permissions и trigger. |
| [apps/backend/test/support/audit.fixture.ts](../apps/backend/test/support/audit.fixture.ts) | Синтетический audit fixture UUID/кодов, не содержит пользовательских данных. |
| [apps/backend/test/unit/audit-entry.spec.ts](../apps/backend/test/unit/audit-entry.spec.ts) | Unit validation/redaction и отказ от unsafe audit payload. |
| [docs/adr/0008-transactions-and-audit.md](../docs/adr/0008-transactions-and-audit.md) | 0008. Явный transaction context и append-only audit. |
| [docs/reports/wms-103.md](../docs/reports/wms-103.md) | WMS-103: транзакции и аудит. |
| [docs/transactions.md](../docs/transactions.md) | Транзакции и аудит WMS-103. |
| [apps/backend/src/modules/audit/audit-entry.ts](../apps/backend/src/modules/audit/audit-entry.ts) | Чистые helpers audit validation/allowlist/redaction; типы находятся в dto/. |
| [apps/backend/src/modules/audit/audit.schema.ts](../apps/backend/src/modules/audit/audit.schema.ts) | Drizzle audit_entries schema, constraints и индексы рядом с модулем. |
| [apps/backend/test/unit/audit.service.spec.ts](../apps/backend/test/unit/audit.service.spec.ts) | Service delegation: тот же context, только безопасные данные, проброс ошибок и отказ до SQL. |
| [docs/adr/0009-nest-service-repository-default.md](../docs/adr/0009-nest-service-repository-default.md) | 0009. Controller → service → repository по умолчанию. |
| [apps/backend/src/modules/audit/dto/audit-entry.dto.ts](../apps/backend/src/modules/audit/dto/audit-entry.dto.ts) | Внутренние AuditEntryInput, PreparedAuditEntry и SafeAuditChange без HTTP decorators. |
| [apps/backend/src/modules/audit/repositories/audit.repository.ts](../apps/backend/src/modules/audit/repositories/audit.repository.ts) | AuditRepository: SQL INSERT через обязательный transaction context, возврат UUID. |
| [apps/backend/src/modules/audit/services/audit.service.ts](../apps/backend/src/modules/audit/services/audit.service.ts) | Публичный AuditService: validation/redaction, передача подготовленного DTO в repository. |
| [apps/backend/drizzle/0003_charming_satana.sql](../apps/backend/drizzle/0003_charming_satana.sql) | Generated WMS-104 stock schema. |
| [apps/backend/drizzle/0004_inventory-permissions.sql](../apps/backend/drizzle/0004_inventory-permissions.sql) | Авторская custom migration runtime grants и movement append-only function/trigger. |
| [apps/backend/drizzle/meta/0003_snapshot.json](../apps/backend/drizzle/meta/0003_snapshot.json) | Generated Drizzle snapshot WMS-104; pnpm db:generate, не редактировать вручную. |
| [apps/backend/drizzle/meta/0004_snapshot.json](../apps/backend/drizzle/meta/0004_snapshot.json) | Generated Drizzle snapshot WMS-104; pnpm db:generate, не редактировать вручную. |
| [apps/backend/src/infrastructure/database/dev-fixtures.ts](../apps/backend/src/infrastructure/database/dev-fixtures.ts) | Общий dev/test builder: один товар, склад и три зоны через сервисы владельцев; без stock начисления. |
| [apps/backend/src/infrastructure/database/seed-dev.ts](../apps/backend/src/infrastructure/database/seed-dev.ts) | Dev-only CLI fixtures: guard до подключения, одна транзакция, закрытие Nest/pool в finally. |
| [apps/backend/src/modules/catalog/README.md](../apps/backend/src/modules/catalog/README.md) | Catalog module. |
| [apps/backend/src/modules/catalog/catalog.module.ts](../apps/backend/src/modules/catalog/catalog.module.ts) | Nest CatalogModule: private repository, exported CatalogService; без HTTP CRUD. |
| [apps/backend/src/modules/catalog/catalog.schema.ts](../apps/backend/src/modules/catalog/catalog.schema.ts) | Catalog-owned products: unique normalized SKU и единица piece первого релиза. |
| [apps/backend/src/modules/catalog/dto/product.dto.ts](../apps/backend/src/modules/catalog/dto/product.dto.ts) | Внутренние DTO catalog; только штуки, публичного HTTP API пока нет. |
| [apps/backend/src/modules/catalog/repositories/catalog.repository.ts](../apps/backend/src/modules/catalog/repositories/catalog.repository.ts) | Catalog SQL: создание и поиск по id через borrowed transaction client. |
| [apps/backend/src/modules/catalog/services/catalog.service.ts](../apps/backend/src/modules/catalog/services/catalog.service.ts) | Публичный CatalogService: нормализация товара, обязательный audit и lookup для inventory. |
| [apps/backend/src/modules/inventory/README.md](../apps/backend/src/modules/inventory/README.md) | Inventory module. |
| [apps/backend/src/modules/inventory/dto/stock.dto.ts](../apps/backend/src/modules/inventory/dto/stock.dto.ts) | Внутренние DTO inventory: ключ остатка, положительное начисление и результат без ORM rows. |
| [apps/backend/src/modules/inventory/inventory.module.ts](../apps/backend/src/modules/inventory/inventory.module.ts) | InventoryModule: единственный экспорт InventoryService; repositories других модулей не импортируются. |
| [apps/backend/src/modules/inventory/inventory.schema.ts](../apps/backend/src/modules/inventory/inventory.schema.ts) | Inventory-owned balances/movements: int4 checks, unique stock key и composite location ownership FK. |
| [apps/backend/src/modules/inventory/repositories/inventory.repository.ts](../apps/backend/src/modules/inventory/repositories/inventory.repository.ts) | Inventory SQL: атомарный guarded upsert без lost update и INSERT immutable movement. |
| [apps/backend/src/modules/inventory/services/inventory.service.ts](../apps/backend/src/modules/inventory/services/inventory.service.ts) | InventoryService — единственный владелец начисления: validation, справочники, balance+audit+movement. |
| [apps/backend/src/modules/warehouses/README.md](../apps/backend/src/modules/warehouses/README.md) | Warehouses module. |
| [apps/backend/src/modules/warehouses/dto/warehouse.dto.ts](../apps/backend/src/modules/warehouses/dto/warehouse.dto.ts) | Внутренние DTO склада/ячеек; зона выражена kind ячейки, отдельной Zone entity пока нет. |
| [apps/backend/src/modules/warehouses/repositories/warehouses.repository.ts](../apps/backend/src/modules/warehouses/repositories/warehouses.repository.ts) | Warehouses SQL: только собственные таблицы, общий transaction context, без commit. |
| [apps/backend/src/modules/warehouses/services/warehouses.service.ts](../apps/backend/src/modules/warehouses/services/warehouses.service.ts) | WarehousesService: создание с audit и проверка принадлежности/назначения ячейки для inventory. |
| [apps/backend/src/modules/warehouses/warehouses.module.ts](../apps/backend/src/modules/warehouses/warehouses.module.ts) | WarehousesModule: экспорт сервиса, repository private, нет публичных CRUD endpoints. |
| [apps/backend/src/modules/warehouses/warehouses.schema.ts](../apps/backend/src/modules/warehouses/warehouses.schema.ts) | Warehouses-owned таблицы: склад, ячейка, unique code и composite ownership key. |
| [apps/backend/src/shared/operations/README.md](../apps/backend/src/shared/operations/README.md) | Operation metadata. |
| [apps/backend/src/shared/operations/dto/operation-metadata.dto.ts](../apps/backend/src/shared/operations/dto/operation-metadata.dto.ts) | Общие внутренние метаданные мутации: доверенный субъект, корреляция и код основания. |
| [apps/backend/src/shared/quantities/README.md](../apps/backend/src/shared/quantities/README.md) | Quantity contract. |
| [apps/backend/src/shared/quantities/quantity.ts](../apps/backend/src/shared/quantities/quantity.ts) | Общий int4-контракт количества: SQL, внутренние DTO, аудит и draft event schema. |
| [apps/backend/src/shared/validation/README.md](../apps/backend/src/shared/validation/README.md) | Resource validation. |
| [apps/backend/src/shared/validation/identifiers.ts](../apps/backend/src/shared/validation/identifiers.ts) | Переиспользуемая UUID-проверка для внутренних DTO; не раскрывает значения при отказе. |
| [apps/backend/src/shared/validation/resource-fields.ts](../apps/backend/src/shared/validation/resource-fields.ts) | Общая нормализация SKU/code и названий ресурсов catalog/warehouses. |
| [apps/backend/test/integration/stock.spec.ts](../apps/backend/test/integration/stock.spec.ts) | WMS-104 PostgreSQL: catalog/warehouse constraints, receipt atomicity, absent-key race, overflow и immutable movement. |
| [apps/backend/test/unit/stock-quantity.spec.ts](../apps/backend/test/unit/stock-quantity.spec.ts) | Boundary/contract tests WMS-104: int4 quantity в service, audit и неопубликованной event schema. |
| [docs/adr/0010-minimal-stock.md](../docs/adr/0010-minimal-stock.md) | 0010. Int4 stock quantity и минимальное внутреннее начисление. |
| [docs/reports/wms-104.md](../docs/reports/wms-104.md) | WMS-104: минимальные складские данные. |
| [docs/stock-baseline.md](../docs/stock-baseline.md) | Минимальные складские данные WMS-104. |
| [apps/backend/scripts/generate-event-contracts.cjs](../apps/backend/scripts/generate-event-contracts.cjs) | Генератор TypeScript и runtime schemas из исходных JSON Schema; --check обнаруживает missing/stale output без записи. |
| [apps/backend/src/shared/events/README.md](../apps/backend/src/shared/events/README.md) | Бизнес- и техническая документация event contracts: границы, ошибки, настройка, limits и движение данных. |
| [apps/backend/src/shared/events/event-registry.ts](../apps/backend/src/shared/events/event-registry.ts) | Локальный type/version registry, Ajv 2020-12/full formats и общие event/receipt limits. |
| [apps/backend/src/shared/events/event-contract.error.ts](../apps/backend/src/shared/events/event-contract.error.ts) | Безопасные permanent contract error codes без payload в диагностике. |
| [apps/backend/src/shared/events/dto/event.dto.ts](../apps/backend/src/shared/events/dto/event.dto.ts) | Внутренние KnownEvent/PreparedEvent и payload alias из generated contract; не HTTP/ORM DTO. |
| [apps/backend/src/shared/events/services/event-contracts.ts](../apps/backend/src/shared/events/services/event-contracts.ts) | Producer snapshot validation и вход handler: UTF-8 bytes, JSON, registry и полный envelope/payload. |
| [apps/backend/src/shared/events/generated/event-types.ts](../apps/backend/src/shared/events/generated/event-types.ts) | Generated TS из docs/contracts/events: pnpm contracts:generate; вручную не редактировать, diff проверяет contracts:check. |
| [apps/backend/src/shared/events/generated/event-schemas.ts](../apps/backend/src/shared/events/generated/event-schemas.ts) | Generated runtime schema bundle из тех же JSON: pnpm contracts:generate; без docs runtime, без ручных правок. |
| [apps/backend/test/unit/event-contracts.spec.ts](../apps/backend/test/unit/event-contracts.spec.ts) | Контрактные fixtures и обе runtime границы: UUID/UTC/int4/required/unknown fields/version/line/UTF-8 limits. |
| [apps/backend/test/unit/event-generation.spec.ts](../apps/backend/test/unit/event-generation.spec.ts) | Детерминированная generation, missing/stale checks в temporary directory; Node subprocess и finally cleanup. |
| [docs/contracts/fixtures/README.md](../docs/contracts/fixtures/README.md) | Назначение синтетических полных contract fixtures и ожидаемые результаты validation. |
| [docs/contracts/fixtures/receiving.optional-fields.json](../docs/contracts/fixtures/receiving.optional-fields.json) | ReceivingPosted с неизвестными optional fields в envelope/payload/line; все поля принимаются и сохраняются. |
| [docs/contracts/fixtures/receiving.unknown-version.json](../docs/contracts/fixtures/receiving.unknown-version.json) | ReceivingPosted с schemaVersion=2; ожидается UNSUPPORTED_EVENT на обеих границах. |
| [docs/contracts/fixtures/receiving.invalid-payload.json](../docs/contracts/fixtures/receiving.invalid-payload.json) | ReceivingPosted с quantity=0; ожидается INVALID_EVENT на обеих границах. |
| [docs/adr/0011-event-contract-validation.md](../docs/adr/0011-event-contract-validation.md) | Решение об Ajv, generation, runtime boundaries и пределах неопубликованного ReceivingPosted v1. |
| [docs/reports/wms-105.md](../docs/reports/wms-105.md) | Результаты WMS-105, проверки, ограничения и обязательные точки подключения в WMS-106/109. |
| [apps/backend/drizzle/0005_bitter_prism.sql](../apps/backend/drizzle/0005_bitter_prism.sql) | Generated Drizzle migration WMS-106: четыре outbox таблицы, PK/unique/FK/CHECK и индексы; генерация pnpm db:generate, не править вручную. |
| [apps/backend/drizzle/0006_outbox-retention.sql](../apps/backend/drizzle/0006_outbox-retention.sql) | Авторская custom migration: warehouse_app grants, immutable event и retention DELETE/TRUNCATE guards; scaffold Drizzle Kit --custom. |
| [apps/backend/drizzle/meta/0005_snapshot.json](../apps/backend/drizzle/meta/0005_snapshot.json) | Generated snapshot outbox schema от Drizzle Kit; pnpm db:generate, ручное редактирование запрещено. |
| [apps/backend/drizzle/meta/0006_snapshot.json](../apps/backend/drizzle/meta/0006_snapshot.json) | Generated snapshot custom outbox migration scaffold; triggers/grants описаны SQL/README, snapshot вручную не менять. |
| [apps/backend/src/infrastructure/outbox/README.md](../apps/backend/src/infrastructure/outbox/README.md) | Менеджерская и техническая документация writer: DTO, sequence diagram, SQL/commit/rollback, errors, retention и ограничения. |
| [apps/backend/src/infrastructure/outbox/dto/append-event.dto.ts](../apps/backend/src/infrastructure/outbox/dto/append-event.dto.ts) | Внутренний append DTO: producer задаёт факт и generated payload, writer владеет eventId/aggregateVersion. |
| [apps/backend/src/infrastructure/outbox/outbox-destinations.ts](../apps/backend/src/infrastructure/outbox/outbox-destinations.ts) | Стабильный inventory.putaway destination полного receipt stream и безопасный maximum aggregateVersion. |
| [apps/backend/src/infrastructure/outbox/outbox.module.ts](../apps/backend/src/infrastructure/outbox/outbox.module.ts) | Nest composition OutboxService/private OutboxRepository без собственного pool или запуска worker. |
| [apps/backend/src/infrastructure/outbox/outbox.schema.ts](../apps/backend/src/infrastructure/outbox/outbox.schema.ts) | Drizzle source counter/events/deliveries/streams с индексами, identity/unique/FK/CHECK. |
| [apps/backend/src/infrastructure/outbox/repositories/outbox.repository.ts](../apps/backend/src/infrastructure/outbox/repositories/outbox.repository.ts) | Private SQL adapter: counter upsert под row lock и INSERT event/message::jsonb/delivery/stream с borrowed context. |
| [apps/backend/src/infrastructure/outbox/services/outbox.service.ts](../apps/backend/src/infrastructure/outbox/services/outbox.service.ts) | Публичный append(context,input): UUID, snapshot, атомарная версия, финальная contract validation, без собственного commit. |
| [apps/backend/test/integration/outbox.spec.ts](../apps/backend/test/integration/outbox.spec.ts) | Реальные PostgreSQL tests WMS-106: stock/audit/outbox atomicity, locks/rollback/crash, unique/constraints и retention права. |
| [apps/backend/test/support/outbox.fixture.ts](../apps/backend/test/support/outbox.fixture.ts) | Синтетический AppendEventDto из contract example, загрузка файла до транзакций, без копирования бизнес-логики. |
| [docs/adr/0012-outbox-writer.md](../docs/adr/0012-outbox-writer.md) | Решение WMS-106 о counter/row locks, write interface, первом destination и immutable retention. |
| [docs/reports/wms-106.md](../docs/reports/wms-106.md) | Результаты и проверки writer WMS-106, найденный pg client error, ограничения и следующая задача. |
| [apps/backend/drizzle/0007_dizzy_george_stacy.sql](../apps/backend/drizzle/0007_dizzy_george_stacy.sql) | Generated http_idempotency schema/PK/checks от Drizzle Kit; pnpm db:generate, вручную не менять. |
| [apps/backend/drizzle/0008_idempotency-retention.sql](../apps/backend/drizzle/0008_idempotency-retention.sql) | Авторская custom migration: runtime grants, immutable identity/completed result и retained DELETE/TRUNCATE guard. |
| [apps/backend/drizzle/meta/0007_snapshot.json](../apps/backend/drizzle/meta/0007_snapshot.json) | Generated Drizzle snapshot idempotency schema; pnpm db:generate, ручное редактирование запрещено. |
| [apps/backend/drizzle/meta/0008_snapshot.json](../apps/backend/drizzle/meta/0008_snapshot.json) | Generated snapshot custom migration scaffold; triggers/grants в SQL/README, не редактировать вручную. |
| [apps/backend/scripts/generate-openapi.cjs](../apps/backend/scripts/generate-openapi.cjs) | Offline production OpenAPI generation/diff без app.init/БД/.env, config override и finally app.close; требует build. |
| [apps/backend/src/infrastructure/http/README.md](../apps/backend/src/infrastructure/http/README.md) | HTTP boundaries для менеджера/разработчика: движение данных, DTO/actor/errors/OpenAPI и ограничения. |
| [apps/backend/src/infrastructure/http/configure-http.ts](../apps/backend/src/infrastructure/http/configure-http.ts) | Общая настройка middleware, JSON body limit и api/v1 prefix кроме технических GET до init. |
| [apps/backend/src/infrastructure/http/dev-actor.guard.ts](../apps/backend/src/infrastructure/http/dev-actor.guard.ts) | Fail-closed opt-in loopback dev/test actor и trusted operation/key scope; технические handlers исключены. |
| [apps/backend/src/infrastructure/http/http-command.decorator.ts](../apps/backend/src/infrastructure/http/http-command.decorator.ts) | TechnicalRoute/HttpCommand/CommandContext и command OpenAPI header/error metadata. |
| [apps/backend/src/infrastructure/http/http.module.ts](../apps/backend/src/infrastructure/http/http.module.ts) | Глобальные Nest validation/guard/problem providers без публичного business controller. |
| [apps/backend/src/infrastructure/http/openapi.ts](../apps/backend/src/infrastructure/http/openapi.ts) | Production graph OpenAPI builder: только реальные routes, Problem codes и header schemas. |
| [apps/backend/src/infrastructure/http/problem.filter.ts](../apps/backend/src/infrastructure/http/problem.filter.ts) | Безопасный problem+json mapper по allowlisted codes/SQLSTATE без исходных errors/values. |
| [apps/backend/src/infrastructure/http/request-context.ts](../apps/backend/src/infrastructure/http/request-context.ts) | Correlation middleware и WeakMap request context/command scope без глобального actor или утечек запросов. |
| [apps/backend/src/infrastructure/idempotency/README.md](../apps/backend/src/infrastructure/idempotency/README.md) | Atomic HTTP dedup protocol, SQL races, snapshot/retention, примеры, commit/rollback и ограничения. |
| [apps/backend/src/infrastructure/idempotency/idempotency.module.ts](../apps/backend/src/infrastructure/idempotency/idempotency.module.ts) | DI command service/private repository, reuse DatabaseModule и общего runner. |
| [apps/backend/src/infrastructure/idempotency/idempotency.schema.ts](../apps/backend/src/infrastructure/idempotency/idempotency.schema.ts) | Scope/hash/pending/result таблица, unique PK и success CHECK; source Drizzle schema. |
| [apps/backend/src/infrastructure/idempotency/repositories/idempotency.repository.ts](../apps/backend/src/infrastructure/idempotency/repositories/idempotency.repository.ts) | Private claim INSERT, отдельный read committed SELECT и complete UPDATE в borrowed context. |
| [apps/backend/src/infrastructure/idempotency/services/http-commands.service.ts](../apps/backend/src/infrastructure/idempotency/services/http-commands.service.ts) | Владелец command run: canonical hash, dedup/replay/conflict, callback/result/business commit атомарны. |
| [apps/backend/src/shared/errors/README.md](../apps/backend/src/shared/errors/README.md) | Назначение безопасных error codes, пример mapper/rollback и отсутствие transport/I/O в shared. |
| [apps/backend/src/shared/errors/command-error.ts](../apps/backend/src/shared/errors/command-error.ts) | Доверенные прикладные error codes без arbitrary detail или HTTP зависимостей. |
| [apps/backend/src/shared/operations/dto/command-scope.dto.ts](../apps/backend/src/shared/operations/dto/command-scope.dto.ts) | Внутренние trusted CommandScope и allowlisted JSON CommandResult, не HTTP body/ORM models. |
| [apps/backend/src/shared/serialization/README.md](../apps/backend/src/shared/serialization/README.md) | Canonical JSON: нормализация keys, ограничения input, ошибки и потребители hashing/snapshot. |
| [apps/backend/src/shared/serialization/canonical-json.ts](../apps/backend/src/shared/serialization/canonical-json.ts) | Стабильная plain JSON сериализация с bounds/cycle/getter rejection, без toJSON/coercion/I/O. |
| [apps/backend/test/integration/http-commands.spec.ts](../apps/backend/test/integration/http-commands.spec.ts) | Реальные HTTP/DB normalized replay/race/rollback/client timeout, safe problems/dev isolation и grants. |
| [apps/backend/test/support/http-command.fixture.ts](../apps/backend/test/support/http-command.fixture.ts) | Test-only DTO/probe/controller с реальными metadata/audit/outbox; отсутствует production graph/OpenAPI. |
| [apps/backend/test/unit/http-foundation.spec.ts](../apps/backend/test/unit/http-foundation.spec.ts) | Canonical JSON invariants и fail-closed dev actor config, без Docker. |
| [docs/contracts/openapi.json](../docs/contracts/openapi.json) | Generated production OpenAPI: pnpm openapi:generate, bytes diff openapi:check; вручную не менять, paths только / и /health. |
| [docs/adr/0013-http-idempotency.md](../docs/adr/0013-http-idempotency.md) | Принятое решение HTTP boundaries, UUID keys, isolated dev actor и atomic command responses. |
| [docs/reports/wms-107.md](../docs/reports/wms-107.md) | Результат и evidence WMS-107, тестовый controller/timeout, ограничения и следующий WMS-108. |
