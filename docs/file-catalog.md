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
| [apps/backend/src/app.module.ts](../apps/backend/src/app.module.ts) | Корневой Nest module: связывает контроллер и сервис. |
| [apps/backend/src/app.service.ts](../apps/backend/src/app.service.ts) | Статическое приветствие API без I/O. |
| [apps/backend/src/main.ts](../apps/backend/src/main.ts) | HTTP bootstrap, PORT, shutdown hooks и ошибка запуска. |
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
| [docs/development-plan.md](../docs/development-plan.md) | Пошаговый backlog разработки: зависимости, критерии приёмки, проверки и демонстрации. |
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
