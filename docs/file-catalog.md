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
| [apps/backend/src/app.module.ts](../apps/backend/src/app.module.ts) | Корневой Nest module: контроллер/сервис, DatabaseModule и AuditModule. |
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
| [docs/contracts/examples/receiving.receipt-posted.v1.json](../docs/contracts/examples/receiving.receipt-posted.v1.json) | Пример валидного события приёмки для документации и будущих contract tests. |
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
| [apps/backend/src/infrastructure/database/schema.ts](../apps/backend/src/infrastructure/database/schema.ts) | Агрегатор source schemas metadata/audit, без складских таблиц. |
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
