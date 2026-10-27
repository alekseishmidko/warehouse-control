# Миграции WMS-101

Каталог generated assets Drizzle Kit. Source schema —
`../src/infrastructure/database/schema.ts`, config — `../drizzle.config.ts`.

| Файл | Назначение |
|---|---|
| 0000_huge_robin_chapel.sql | Первая миграция: application_metadata с key PK, value и created_at; бизнес-таблиц и данных нет |
| 0001_marvelous_ogun.sql | Generated audit schema: таблица, constraints и индексы |
| 0002_audit-append-only.sql | Авторская custom migration: warehouse_app group, grants и append-only trigger |
| meta/0001_snapshot.json, meta/0002_snapshot.json | Generated audit snapshots/schema diff; не описывают trigger/grants |
| meta/0000_snapshot.json | Generated snapshot структуры для вычисления следующего diff |
| meta/_journal.json | Generated последовательность, timestamps и tags SQL-файлов |

Из корня: `pnpm db:generate`, затем проверить SQL и применить `pnpm db:migrate`.
SQL и meta коммитятся вместе; generated файлы не менять вручную,
применённую миграцию не перегенерировать задним числом.
Повторная generation без изменений должна сообщать no schema changes.
Существующий baseline не удаляет и не преобразует пользовательские данные.
Обратная destructive migration автоматически не выполняется; удаление dev volume
описано в [Compose](../../../infra/compose/README.md).

Custom migration scaffold создан Drizzle Kit, затем заполнен авторским SQL:
это исходный код permissions/trigger, а не редактирование generated snapshot.
После применения custom migration тоже неизменяема. Повтор db:generate не управляет
DB ролями/trigger автоматически. WMS-103 миграции требуют CREATEROLE либо заранее
подготовленной безопасной группы. Ограничения и login provisioning —
[transactions](../../../docs/transactions.md).

## WMS-104

0003_charming_satana.sql — generated tables products/warehouses/locations,
stock_balances/stock_movements с FK/unique/CHECK. 0004_inventory-permissions.sql —
авторская custom migration grants и movement append-only function/trigger.
meta/0003_snapshot.json и meta/0004_snapshot.json generated Kit; не редактировать.
Прежние SQL migrations не менялись. Миграции проверены на чистой Testcontainers БД;
dev Compose нужно мигрировать явно. Подробности — [stock baseline](../../../docs/stock-baseline.md).

## WMS-106

0005_bitter_prism.sql — generated outbox_events/outbox_deliveries/delivery_streams
и дополнительный transactional outbox_aggregate_sequences: PK/unique/FK/CHECK/indexes.
0006_outbox-retention.sql — авторская custom migration immutable envelope,
retention DELETE/TRUNCATE guards и warehouse_app grants. Scaffold:
`pnpm --filter @warehouse/backend exec drizzle-kit generate --custom --name=outbox-retention`.
meta/0005_snapshot.json и meta/0006_snapshot.json — generated Kit, вместе с journal;
не редактировать вручную. Custom grants/triggers не отображаются schema snapshot.
Проверены чистая БД и повтор миграции, db:generate после них не даёт schema changes.
Dev volume не мигрируется автоматически; после обновления выполнить pnpm db:migrate.
Удаление исторических outbox rows запрещено до отдельной replay/retention policy.
[Файлы/инварианты/права](../src/infrastructure/outbox/README.md).


## WMS-107

0007_dizzy_george_stacy.sql — generated http_idempotency со scope PK и hash/result CHECK.
0008_idempotency-retention.sql — custom warehouse_app grants, immutable identity/completed
result trigger и retained DELETE/TRUNCATE guard (общая function WMS-106). Scaffold создан
`pnpm --filter @warehouse/backend exec drizzle-kit generate --custom --name=idempotency-retention`.
meta/0007_snapshot.json, meta/0008_snapshot.json и journal generated Kit; вручную не править,
triggers/grants не представлены snapshot. Старые SQL migrations не менялись.
Dev БД мигрировать явно через pnpm db:migrate, disposable test cleanup не трогает её volume.
Storage protocol/ретенция — [idempotency README](../src/infrastructure/idempotency/README.md).


## WMS-108

0009_windy_hairball.sql — generated receipts/receipt_lines: state/int4/position CHECK,
unique line product/position, composite location ownership FK, posted event FK.
0010_receiving-guards.sql — custom runtime grants, единственный draft → posted UPDATE,
immutable content/lines, parent lock при INSERT строки и retained DELETE/TRUNCATE guards.
Scaffold: `pnpm --filter @warehouse/backend exec drizzle-kit generate --custom --name=receiving-guards`.
meta/0009_snapshot.json, meta/0010_snapshot.json и _journal.json генерирует Kit,
вручную не менять; triggers/grants не представлены snapshot. Старые migrations не менялись.
Новые таблицы не меняют старые данные; dev volume требует явного pnpm db:migrate.
Test cleanup отключает retained triggers только в disposable admin harness.
[Модель/границы](../src/modules/receiving/README.md).


## WMS-109

0011_spooky_epoch.sql — generated processed_events/consumer_streams, PK/FK/cursor CHECK.
0012_worker-retention.sql — custom runtime grants, append-only markers, retained
consumer streams и monotonic identity/cursor trigger. Scaffold создан через
`pnpm --filter @warehouse/backend exec drizzle-kit generate --custom --name=worker-retention`.
meta/0011_snapshot.json, meta/0012_snapshot.json и journal генерирует Kit; не править
вручную. Triggers/grants не представлены schema snapshot. Старые applied SQL не менялись.
Миграции не удаляют старые данные, dev volume требует явного pnpm db:migrate.
Disposable test cleanup отключает retained/immutable guards только в admin harness.
[Worker модель и границы](../src/infrastructure/worker/README.md).


## WMS-110

0013_glamorous_big_bertha.sql — generated receiving composite unique source keys.
0014_clean_abomination.sql — generated inventory putaway_tasks, source/event-line unique,
FK к posted receipt/source line и audit, pending/int4 CHECK. Генерация разделена на два
последовательных schema состояния: сначала существующие receiving unique keys, затем
новая таблица, чтобы FK не оказались раньше своих targets. Оба SQL — output Kit, не править.
0015_putaway-retention.sql — custom runtime SELECT/INSERT и immutable retained tasks.
Scaffold: `pnpm --filter @warehouse/backend exec drizzle-kit generate --custom --name=putaway-retention`.
meta/0013_snapshot.json, meta/0014_snapshot.json, meta/0015_snapshot.json и journal generated,
не редактировать вручную. Custom triggers/grants описаны здесь, не в schema snapshot.
Старые applied migrations не менялись. Existing receipt rows сохраняются; новые unique keys
не запрещают разрешённые ранее документы, но DDL может блокировать writes. Zero-downtime
не заявлен; dev БД мигрировать явно. [Модель/флоу](../../../docs/flows/putaway.md).
