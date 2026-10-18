# Shared backend

Общие технические контракты, независимые от бизнес-модулей, транспорта, Nest и ORM.

## Для менеджера

Позволяет разным операциям пользоваться одинаковыми гарантиями атомарности.
Сам по себе не реализует приёмку или учёт остатков.

## Для разработчика

Сейчас содержит только [transactions](transactions/README.md): port/context и DI token.
Shared не импортирует infrastructure/modules. Runtime-реализация — в database adapter.
Переиспользуемый test-only код остаётся в test/support, не здесь.
Новых utils-каталогов или общего repository нет. Правила —
[shared/DRY](../../../../docs/shared.md), проверки — `pnpm typecheck`, `pnpm test`.
Конфигурации, SQL, endpoints, событий и собственных фоновых процессов нет.
