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

Реализованы WMS-101–112: PostgreSQL/Drizzle, runtime config, test harness,
транзакции/audit, минимальные catalog/warehouses/inventory, event contracts, outbox writer, HTTP/idempotency и приёмка draft/posted.
Worker/putaway handler готовы WMS-109/110; Docker image/Compose готовы WMS-112; Kubernetes запланирован.

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
pnpm openapi:generate   # Build и offline генерация OpenAPI текущих routes
pnpm openapi:check      # Build и проверка OpenAPI diff без изменения JSON
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
с audit/immutable movement. Документ приёмки реализован WMS-108; публичного CRUD справочников нет.

```sh
pnpm db:migrate # новые migrations, локально выполняется явно
pnpm db:seed    # только development, создаёт новый товар/склад/3 ячейки без stock
```

Повтор db:seed создаёт новый demo set, не обновляет существующие записи.
[Модели и сценарий](docs/stock-baseline.md), [проверки WMS-104](docs/reports/wms-104.md).

## Приёмка WMS-108

[Локальный запуск, HTTP request/response и SQL proof](docs/receiving.md).
Доступны создание draft, GET документа и posting с обязательным Idempotency-Key;
бизнес-routes только для isolated dev/test actor. Остаток/movement/audit/outbox/HTTP result
атомарны, повтор posted с новым key даёт 409. Worker protocol готов; business handler и pending PutawayTask готовы WMS-110.

## Worker WMS-109

`pnpm db:migrate`, `pnpm build`, затем отдельный `pnpm worker` без HTTP listener.
[Конфигурация и протокол](apps/backend/src/infrastructure/worker/README.md).
Claim/lease/token, durable markers/cursors, retry/dead и SIGTERM готовы. WMS-110
регистрирует inventory.putaway: delivery completed, task pending, stock не начисляется повторно.

## Durable putaway WMS-110

`pnpm db:migrate`, `pnpm build`, затем API и отдельный `pnpm worker` с одной БД.
Production inventory.putaway создаёт pending task на строку posted receipt; stock и movement
приёмки не повторяются. Delivery completed означает, что task создана; физическое размещение
ещё не реализовано. [Подробный flow/SQL](docs/flows/putaway.md), [отчёт](docs/reports/wms-110.md).

## Local recovery WMS-111

[Проверенный runbook](docs/runbooks/event-recovery.md): pnpm outbox:inspect/retry/signal,
operator/reason/audit/history, safe JSON и local dead/backlog signal. Команды требуют local
opt-in и DB admin role; внешних уведомлений и admin HTTP для recovery ещё нет; session auth готова WMS-202. Адресный retry сохраняет
UUID и total attempts, не сбрасывает markers/cursors. `pnpm outbox:recovery-check` воспроизводит
реальный recovery с CLI в отдельной PostgreSQL, не меняя dev volume.

## Контейнерный запуск WMS-112

Добавьте CONTAINER_DATABASE_URL из .env.example в существующий .env, согласовав
credentials с PostgreSQL (внутри сети host=postgres, port=5432). Затем:

```sh
pnpm docker:build
pnpm app:up
pnpm app:down # данные сохраняются
```

API health публикуется на localhost:3000; business routes требуют session/warehouse role.
Учебный сценарий приёмки: `pnpm docker:gate` (отдельные БД/project/volume с loopback
auth). Проверка чистой сборки и исключения secret canary: `pnpm docker:image-check`.
Все новые файлы/команды и Mermaid flow — [Docker gate](docs/flows/docker-gate.md),
конфигурация — [Compose](infra/compose/README.md), evidence — [WMS-112](docs/reports/wms-112.md).
Скрипты scripts/docker-gate.cjs и scripts/docker-image-check.cjs — host-only проверки,
не runtime image; первый очищает только свой UUID project/volume, второй — только
свой временный context/archive. Реальная .env ими не загружается.

## Auth WMS-202 и форматирование

Login/password + серверные sessions/warehouse roles реализованы. Dev actor больше не
поддержан. Перед API startup заполнить AUTH_ORIGIN и оба AUTH_SESSION_*_SECONDS в .env:
числовых defaults нет, idle<=absolute, диапазон 30..86400. Сроки товарных резервов не меняются.
После migrations/build первый admin создаётся отдельным `pnpm identity:bootstrap` с
private stdin и one-time opt-in, не публичной регистрацией. [Флоу и безопасный запуск](docs/flows/identity.md),
[API/модуль](apps/backend/src/modules/identity/README.md), [результаты](docs/reports/wms-202.md).
Для обычного Compose NODE_ENV=production нужен HTTPS origin и TLS перед внешним доступом;
изолированный Docker gate использует настоящие bootstrap/login/CSRF/roles на loopback.

Prettier 3.9.10 закреплён как root devDependency, конфигурация .prettierrc.cjs едина для
всего проекта. `pnpm format` форматирует собственные исходники/документы, `pnpm format:check`
проверяет без изменения файлов. .prettierignore исключает dependencies/build outputs,
credentials, applied/generated migrations, generated event artifacts/OpenAPI и lockfile.
DTO identity разделены по контрактам, ORM-таблицы — по файлам в identity/schemas/.

Для покрытия identity: `pnpm test:identity:coverage` (нужен Docker). Порог IdentityController —
100% строк/веток/функций/statements; HTML — apps/backend/coverage/identity/index.html.
[Состав проверок и ограничения](apps/backend/test/README.md#проверка-покрытия-identity).

WMS-203: реализовано полное размещение PutawayTask из receiving в storage одного склада.
GET /api/v1/putaway-tasks/:taskId и идемпотентный POST /:taskId/execute с targetLocationId;
требуются session/CSRF и складские read/putaway права. Миграции — `pnpm db:migrate`,
проверки — `pnpm test`, Docker gate теперь подтверждает receiving=0/storage=10 и replay.
[Подробный flow](docs/flows/putaway-execution.md), [отчёт](docs/reports/wms-203.md).
