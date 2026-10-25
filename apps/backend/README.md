# Backend Warehouse Controller

Документация корневого NestJS-модуля и конфигурации backend после WMS-101–109.

## Для менеджера

API отвечает на технические маршруты и подключается к PostgreSQL.
Приёмка draft/posted реализована: 10 штук, одно движение/событие, атомарность при сбоях.
Worker protocol готов WMS-109; отгрузка, business handler и UI ещё не реализованы.
Будущие сценарии — в [описании продукта](../../docs/product.md).

## Для разработчика

AppModule связывает AppController/AppService, DatabaseModule, AuditModule,
CatalogModule, WarehousesModule, InventoryModule, OutboxModule, HttpModule,
IdempotencyModule и ReceivingModule.
Transaction runner и AuditService/AuditRepository реализованы; catalog/warehouses/inventory baseline и документ приёмки есть,
production авторизации/consumers ещё нет; producer документа использует outbox writer.
Технические маршруты открыты; receiving закрыт guard, opt-in только isolated dev/test.

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
| scripts/generate-event-contracts.cjs | Детерминированная генерация event types/schema bundle; --check только сравнивает |
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

## WMS-105

[Shared events](src/shared/events/README.md): Ajv 2020-12/formats, registry type/version,
producer/handler validation entrypoints и generated DTO. `pnpm contracts:generate`
создаёт TS types/runtime schemas из docs/contracts/events, `pnpm contracts:check`
проверяет generation diff без записи. Artifacts включены в Git; test:prepare запускает
check. Runtime dist не читает docs/JSON. Дополнительных env/DB migrations нет.
ReceivingPosted ограничен 1000 строками и 256 КиБ UTF-8; quantity int4.
Outbox write подключён в WMS-106; handler, HTTP receiving DTO и CI compatibility gate ещё предстоят.

## WMS-106

[Outbox writer](src/infrastructure/outbox/README.md): OutboxModule экспортирует
OutboxService.append(context,command); private repository не открывает транзакций.
UUID/version генерирует writer, prepareForOutbox проверяет финальный snapshot до SQL.
Atomic counter/events/deliveries/streams, immutable/retention grants/triggers:
новые migrations 0005/0006, dev Compose мигрируется явно через pnpm db:migrate.
Документ приёмки подключён WMS-108; worker protocol готов WMS-109, handler — WMS-110. Подробности — [ADR-0012](../../docs/adr/0012-outbox-writer.md).


## WMS-107

[HTTP module](src/infrastructure/http/README.md): /api/v1 prefix кроме технических GET,
DTO validation без coercion, problem mapper и correlationId. DEV_ACTOR_ENABLED=false
по умолчанию; opt-in только explicit dev/test и loopback HTTP_HOST с server actor UUID.
[Idempotency](src/infrastructure/idempotency/README.md) экспортирует HttpCommandsService:
controller передаёт trusted scope/normalized target+body, callback использует один context
для business/audit/outbox, ответ сохраняется до commit. Key — UUID, result 200/201/202 JSON
с relative Location. ReceivingController подключён WMS-108; тестовый /commands остаётся только в tests.

scripts/generate-openapi.cjs создаёт docs/contracts/openapi.json из production graph без
app.init/DB, с @nestjs/testing config override и finally close. Артефакт generated,
ручное редактирование запрещено. `pnpm openapi:generate` / `pnpm openapi:check` делают build
и generate/diff. Test prepare: event contracts check → build → OpenAPI check → compile tests.
Swagger UI не добавлен. Новые migrations 0007/0008, source API не привязан к DB schema.


## WMS-108

[Receiving module](src/modules/receiving/README.md) экспортирует ReceivingService,
controller/repository/DTO разделены. POST /api/v1/receipts → 201 draft/Location,
POST /api/v1/receipts/:receiptId/post → 200 posted, GET того же документа → 200.
Guard проверяет dev actor до каждого replay; production identity/warehouse ACL ещё нет.
Миграции 0009/0010 создают header/строки, constraints и immutable guards.
Приёмка 10 штук оставляет один balance, movement, ReceivingPosted v1 и pending delivery;
задания размещения ещё нет. [Примеры/SQL](../../docs/receiving.md), [отчёт](../../docs/reports/wms-108.md).


## WMS-109

[WorkerModule](src/infrastructure/worker/README.md) запускается отдельным src/worker.ts:
`pnpm build`, `pnpm worker`. AppModule его не импортирует, HTTP listener не создаётся.
Миграции 0011/0012: processed markers/consumer cursors, runtime grants/retention guards.
Worker-only env/defaults — в .env.example и module README. Production handlers пока
не зарегистрированы (WMS-110), pending delivery не подтверждается автоматически.
[Отчёт/проверки](../../docs/reports/wms-109.md), [ADR-0015](../../docs/adr/0015-postgres-worker.md).
