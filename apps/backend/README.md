# Backend Warehouse Controller

Документация корневого NestJS-модуля и конфигурации backend после WMS-101–104.

## Для менеджера

API отвечает на технические маршруты и подключается к PostgreSQL.
Документы приёмки и отгрузка ещё не реализованы; есть внутреннее начисление stock. Критерий текущего результата:
повторяемая миграция, сохранность технических данных после restart и закрытие соединений.
Будущие сценарии — в [описании продукта](../../docs/product.md).

## Для разработчика

AppModule связывает AppController/AppService, DatabaseModule и AuditModule.
Transaction runner и AuditService/AuditRepository реализованы; catalog/warehouses/inventory baseline есть, но документов приёмки,
авторизации, событий и consumers ещё нет.
Стартовые маршруты открыты; это не политика будущих бизнес-endpoints.

| Маршрут | Ответ | Ограничение |
|---|---|---|
| GET / | 200, Warehouse Controller API | Без бизнес-эффектов |
| GET /health | 200, JSON status: ok | Только HTTP, не readiness PostgreSQL |

### Файлы и настройки

| Файл / каталог | Назначение |
|---|---|
| src/main.ts | Config validation, Nest HTTP, shutdown и безопасная ошибка старта |
| src/app.module.ts | Composition root с DatabaseModule и AuditModule |
| src/app.controller.ts | Два технических HTTP routes |
| src/app.service.ts | Статическое приветствие |
| src/infrastructure/ | Config, pg pool/Drizzle, scoped transactions, migrate/check CLI |
| src/shared/ | ORM/transport-independent transaction contracts |
| src/modules/audit/ | AuditService, AuditRepository, redaction и schema; README |
| drizzle.config.ts | PostgreSQL dialect, schema/output пути, validated URL для Kit |
| drizzle/ | Generated SQL, snapshot, journal и README |
| test/ | Jest unit/integration, Testcontainers support, отдельный native dev baseline smoke |
| package.json | Runtime/dev dependencies, scripts и exact версии Drizzle/pg |
| nest-cli.json | sourceRoot src, очистка dist перед build |
| tsconfig.json | strict base TS, decorators/metadata, src → dist |
| tsconfig.build.json | Исключение tests/dependencies/dist из build |
| tsconfig.test.json | Jest/node types, test aliases и output .test-dist |
| jest.config.cjs | Unit/integration projects, mapper на production dist, maxWorkers=2 |

Config [документирован отдельно](src/infrastructure/config/README.md): NODE_ENV,
PORT и DATABASE_URL. API не запускается без валидного URL и доступной БД.
Встроенных миграций при старте нет: выполнить отдельную команду db:migrate.
Логи Nest/console пока не заменены Pino; драйверные ошибки наружу не выводятся.

Из корня: pnpm dev/typecheck/build/start, db:generate/db:migrate/db:check,
 test/test:unit/test:integration/test:config/test:db-baseline. `pnpm start` и db:check требуют актуального build.
Для пакета: `pnpm --filter @warehouse/backend <script>`.
Jest/Supertest/Testcontainers подключены в WMS-102: `pnpm test:unit`,
`pnpm test:integration`, `pnpm test`. Подробности — [test README](test/README.md).
Dev baseline test перезапускает postgres
проекта и не должен выполняться одновременно с API; это не outbox integration suite.
Общий pool adapter переиспользуют Nest и CLI; generic repository не вводится.

Документы: [infrastructure](src/infrastructure/README.md),
[Compose](../../infra/compose/README.md), [ADR](../../docs/adr/README.md),
[план](../../docs/development-plan.md), [отчёт](../../docs/reports/wms-101.md).

WMS-103: [транзакции и аудит](../../docs/transactions.md),
[audit module](src/modules/audit/README.md), [shared](src/shared/README.md).
Внешних audit endpoints нет. Dev Compose credentials не являются production runtime role.

## WMS-104

Новые внутренние модули: [catalog](src/modules/catalog/README.md),
[warehouses](src/modules/warehouses/README.md), [inventory](src/modules/inventory/README.md).
Сервисы экспортируются, repositories private, HTTP routes не добавлены.
Общий quantity/metadata/validation — в shared. Dev seed: pnpm db:seed,
реализован infrastructure/database/dev-fixtures.ts и seed-dev.ts.
[Порядок данных и ограничения](../../docs/stock-baseline.md).
