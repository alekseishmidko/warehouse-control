# Warehouse Controller

Монорепозиторий на pnpm workspaces. Backend на NestJS и TypeScript находится в `apps/backend`.
Новые приложения добавляются в `apps/*`, общие пакеты — в `packages/*`.

## Проектная документация

- [Описание продукта для менеджеров](docs/product.md)
- [Стандарт документации](docs/documentation-standard.md) и [shared/DRY](docs/shared.md)
- [Карта документации и фактический статус](docs/README.md)
- [Архитектура и стек](docs/architecture.md)
- [Домен и инварианты](docs/domain.md)
- [Контракты API и событий](docs/contracts/README.md)
- [Transactional outbox и переход на Kafka](docs/outbox.md)
- [Принятые решения ADR](docs/adr/README.md)
- [Этапы реализации](docs/roadmap.md)
- [Подробный план разработки](docs/development-plan.md)
- [Контекст для агента](AGENTS.md)

Реализованы WMS-101–105: PostgreSQL/Drizzle, runtime config, test harness,
транзакции/audit, минимальные catalog/warehouses/inventory и runtime event contracts.
Документы приёмки, outbox, backend Docker image и Kubernetes ещё запланированы.

## Запуск

Нужны Node.js 22.12+ и pnpm 10. Версия pnpm закреплена в `package.json`.
Если pnpm ещё не установлен, используйте Corepack:

```sh
corepack enable
pnpm install
cp .env.example .env # только если .env отсутствует
pnpm db:up
pnpm db:migrate
pnpm dev
```

`corepack enable` добавляет команду `pnpm`, которая нужна в том числе для корневых скриптов.

API доступен на `http://localhost:3000`:

- `GET /` — приветствие API.
- `GET /health` — `{ "status": "ok" }`.

Порт можно изменить через переменную окружения: `PORT=3001 pnpm dev`.

## Команды из корня

```sh
pnpm dev        # Backend с перезапуском при изменении кода
pnpm typecheck  # Проверка TypeScript во всех пакетах
pnpm build      # Сборка всех пакетов
pnpm start      # Запуск собранного backend (после pnpm build)
pnpm contracts:generate # Типы и runtime schemas из JSON Schema
pnpm contracts:check    # Проверка generation diff без изменения файлов
```

Команды конкретного приложения: `pnpm --filter @warehouse/backend <команда>`.

Документация: [pnpm workspaces](https://pnpm.io/workspaces), [NestJS](https://docs.nestjs.com/first-steps).

## PostgreSQL и конфигурация WMS-101

PORT, NODE_ENV и обязательный DATABASE_URL проверяются до старта.
Backend проверяет подключение к БД при запуске и закрывает pool при SIGTERM.
`/health` по-прежнему проверяет только ответ HTTP-процесса, а не readiness БД.

```sh
pnpm db:up       # Compose PostgreSQL с ожиданием healthcheck
pnpm db:generate # schema -> SQL + meta, без применения
pnpm db:migrate  # build + CLI миграций
pnpm db:check    # read-only проверка, после build/migrate
pnpm db:down     # остановка с сохранением volume
pnpm test:config # alias Jest unit tests без Docker
pnpm test:db-baseline # dev-only migrate twice + restart PostgreSQL
```

Подробности, диагностика и **удаление dev volume** — в [Compose README](infra/compose/README.md).
Проверенные версии и ограничения — в [отчёте WMS-101](docs/reports/wms-101.md).
Корневой package.json задаёт scripts/engines/pnpm; pnpm-workspace.yaml — границы
apps/packages и разрешённый Nest build hook. tsconfig.base.json — strict ES2022/CommonJS.
.gitignore исключает зависимости, dist, IDE и .env. .env.example — публичные dev-настройки.
pnpm-lock.yaml генерируется pnpm install, вручную не редактируется; проверка установки
использует pnpm install --frozen-lockfile.

## Тесты WMS-102

```sh
pnpm test:unit        # конфигурация, без Docker
pnpm test:integration # PostgreSQL Testcontainers + migrations + HTTP
pnpm test            # оба проекта
```

Compose не нужен для integration: временные containers с динамическими портами
и отдельной БД на suite создаются и удаляются автоматически. Недоступный Docker
вызывает ошибку, а не skip. Инструкции и диагностика — [test README](apps/backend/test/README.md),
результаты — [отчёт WMS-102](docs/reports/wms-102.md).

## Транзакции и аудит WMS-103

Реализованы общий transaction port/context, PostgreSQL runner и AuditService/AuditRepository.
Изменения и audit используют одну транзакцию; ошибку audit нельзя игнорировать.
Новые migrations добавляют таблицу, runtime permission group и append-only trigger.
Dev Compose остаётся admin-стендом, runtime login внешнего окружения ещё не provisioned.
Применение к локальной БД — отдельная команда pnpm db:migrate.
Правила и ограничения: [transactions](docs/transactions.md),
результаты: [отчёт WMS-103](docs/reports/wms-103.md).

## Минимальные складские данные WMS-104

Внутренние catalog/warehouses/inventory сервисы, quantity int4, атомарный приход
с audit/immutable movement. Публичного складского CRUD и документа приёмки пока нет.

```sh
pnpm db:migrate # новые migrations, локально выполняется явно
pnpm db:seed    # только development, создаёт новый товар/склад/3 ячейки без stock
```

Повтор db:seed создаёт новый demo set, не обновляет существующие записи.
[Модели и сценарий](docs/stock-baseline.md), [проверки WMS-104](docs/reports/wms-104.md).
