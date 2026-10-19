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
