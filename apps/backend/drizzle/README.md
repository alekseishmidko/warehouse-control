# Миграции WMS-101

Каталог generated assets Drizzle Kit. Source schema —
`../src/infrastructure/database/schema.ts`, config — `../drizzle.config.ts`.

| Файл | Назначение |
|---|---|
| 0000_huge_robin_chapel.sql | Первая миграция: application_metadata с key PK, value и created_at; бизнес-таблиц и данных нет |
| meta/0000_snapshot.json | Generated snapshot структуры для вычисления следующего diff |
| meta/_journal.json | Generated последовательность, timestamps и tags SQL-файлов |

Из корня: `pnpm db:generate`, затем проверить SQL и применить `pnpm db:migrate`.
SQL и meta коммитятся вместе; generated файлы не менять вручную,
применённую миграцию не перегенерировать задним числом.
Повторная generation без изменений должна сообщать no schema changes.
Существующий baseline не удаляет и не преобразует пользовательские данные.
Обратная destructive migration автоматически не выполняется; удаление dev volume
описано в [Compose](../../../infra/compose/README.md).
