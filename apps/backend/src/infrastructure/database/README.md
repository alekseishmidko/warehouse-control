# PostgreSQL и Drizzle

Технический database adapter WMS-101: baseline, startup connection check,
генерируемые migrations и управляемый жизненный цикл pool.

## Для менеджера

Сохраняет только технические метаданные, не остатки или заказы.
Повторная миграция не дублирует структуру; рестарт PostgreSQL сохраняет данные
в volume. Простой `/health` пока проверяет HTTP-процесс, а не текущую готовность БД.

## Для разработчика

| Файл | Контракт |
|---|---|
| schema.ts | Таблица application_metadata: key PK, value, created_at UTC; warehouse-домена нет |
| connection.ts | Создаёт Pool и typed Drizzle; владелец обязан вызвать pool.end() |
| database.module.ts | DatabaseModule экспортирует DatabaseService, подключает БД при Nest init и закрывает при destroy |
| migrate.ts | CLI применяет generated SQL, использует finally для закрытия pool, exit 1 при ошибке |
| check.ts | Read-only CLI читает server_version и baseline table, закрывает pool |

DATABASE_CONFIG — DI token RuntimeConfig, production provider вызывает loadEnvironment.
Test harness заменяет provider готовым валидированным config, не меняя env.
DatabaseService.db — Drizzle handle; прямое владение pool остаётся у сервиса.
Pool max=5, connect timeout=5 секунд, idle timeout=10 секунд,
application_name=warehouse-controller. Это первоначальные локальные настройки,
а не измеренный production sizing. Idle pool errors и ошибки CLI не раскрывают
driver error object, URL или SQL-параметры. При диагностике ориентироваться на
Compose health/logs и результаты проверки конфигурации.

`DATABASE_URL` берётся из [config](../config/README.md). Nest startup выполняет
SELECT 1 до открытия HTTP. При ошибке подключение закрывается. При bind failure
main закрывает приложение; SIGTERM запускает shutdown hooks и закрывает pool.
Startup не применяет миграции автоматически. Прикладные транзакции — следующая задача WMS-103.

## Миграции и команды из корня

```sh
pnpm db:generate # schema.ts -> drizzle SQL + snapshot/journal; не применяет SQL
pnpm db:migrate  # сборка + отдельный CLI; требует работающую БД
pnpm db:check    # read-only проверка; выполнить после build/migrate
```

Drizzle Kit config: `apps/backend/drizzle.config.ts`; отдельная от Nest build
tooling-конфигурация. Generated migrations — `apps/backend/drizzle/`.
Журнал применённых миграций — `drizzle.__drizzle_migrations` в PostgreSQL.
Запускать migrator одним процессом; сериализация нескольких deployment jobs пока
не реализована. Повтор уже применённой миграции пропускается по journal.
Runtime CLI ищет migration assets рядом с backend; будущий Docker image обязан
включать `drizzle/`, одного `dist/` недостаточно.

Первый baseline содержит application_metadata и timestamp default now();
не содержит business seed, outbox и API для изменения метаданных.
Применённые migrations не редактируются. Expand/contract и отдельный migration Job
добавятся на Kubernetes-этапе. См. [описание generated assets](../../../drizzle/README.md).

## Проверки и эксплуатация

`pnpm test:db-baseline` — opt-in dev-проверка с реальным PostgreSQL и restart;
описание ограничений и удаления volume — в [Compose README](../../../../../infra/compose/README.md).
Это не Testcontainers suite. Права runtime и migration role пока не разделены:
Compose использует локальную dev-роль; внешний стенд с ней не разворачивается.
Событий и consumers на этом этапе нет.

Источники: [Drizzle migrations](https://orm.drizzle.team/docs/migrations),
[node-postgres pooling](https://node-postgres.com/features/pooling).

## Integration harness WMS-102

Jest/PostgreSQL Testcontainers применяет реальные migrations к отдельной БД на suite;
Supertest поднимает настоящий AppModule с override DATABASE_CONFIG. Dev .env и volume
не используются. Проверены commit/rollback, pool cleanup и ошибка теста.
Команды и ограничения — [tests README](../../../test/README.md).
