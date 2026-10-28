# Локальный PostgreSQL

Compose-стенд WMS-101 содержит только PostgreSQL, а API запускается на host.
Конфигурация `compose.yaml` закрепляет PostgreSQL 17.9 bookworm по multi-arch digest,
named volume, healthcheck и host binding только `127.0.0.1:15432` по умолчанию.
Это локальный стенд, не production/HA-инсталляция.

## Запуск из корня репозитория

```sh
cp .env.example .env # только если .env ещё нет; существующий файл не перезаписывать
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm db:check
pnpm dev
```

Нужны запущенный Docker daemon и Compose v2. `pnpm db:up` ждёт healthcheck.
Файл `.env` не коммитится; `.env.example` содержит публичные dev-значения,
которые нельзя использовать для внешнего стенда. При смене POSTGRES_* обновить
DATABASE_URL; пароль внутри URL кодируется по правилам URL.
`POSTGRES_PORT` меняет host port, не внутренний порт PostgreSQL 5432.
Порт 5433 на проверенной машине занят другим проектом, поэтому выбран 15432.

## Обслуживание и данные

```sh
docker compose --env-file .env -f infra/compose/compose.yaml ps
docker compose --env-file .env -f infra/compose/compose.yaml logs postgres
docker compose --env-file .env -f infra/compose/compose.yaml restart postgres
pnpm db:down
```

`db:down` останавливает сервис и удаляет сеть, сохраняя named volume
`warehouse-controller_postgres-data`. POSTGRES_USER/PASSWORD/DB инициализируют
только пустой volume; смена `.env` не меняет существующий пароль или базу.
Для существующей БД нужны явные SQL-изменения или пересоздание dev volume.

**Удаление локальных данных необратимо.** Только если они больше не нужны:

```sh
docker compose --env-file .env -f infra/compose/compose.yaml down --volumes
```

Команда удаляет данные именно этого Compose-проекта; после этого выполнить up и migrate.
Не использовать Docker-wide prune для очистки проекта.

## Проверка WMS-101

```sh
pnpm test:config
pnpm test:db-baseline
```

Вторая команда требует работающий Compose, development и локальный DATABASE_URL.
Она применяет миграцию дважды, создаёт временную metadata-запись, перезапускает
**postgres этого проекта**, проверяет сохранность и удаляет запись.
Не выполнять одновременно с работающим API/другой проверкой этого стенда:
restart прервёт их соединения. Проверка предназначена для baseline WMS-101
с текущим журналом migrations; число applied migrations сверяется с generated journal.
Изолированный harness WMS-102 реализован: `pnpm test:integration` не требует этого
Compose-стенда и не перезапускает его; см. [tests README](../../apps/backend/test/README.md).

Ошибки подключения: проверить Docker context/daemon, свободный порт, healthcheck,
согласованность `.env` и ранее созданного volume. Не публиковать вывод
`docker compose config` без проверки: он содержит подставленные credentials.

Источники: [PostgreSQL official image](https://hub.docker.com/_/postgres),
[Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql).

WMS-103 добавляет audit migrations и NOLOGIN permission group warehouse_app.
Dev admin URL остаётся прежним. Миграции требуют CREATEROLE либо заранее
подготовленной безопасной группы. Production login и его credentials provisioned
отдельно; не использовать этот Compose account во внешнем окружении.

WMS-104: после pnpm db:migrate можно выполнить pnpm db:seed — новый demo товар,
склад и три ячейки без начисления. Команда разрешена только development и каждый раз
создаёт новый набор; подробности — [stock baseline](../../docs/stock-baseline.md).

## API/worker в Docker — WMS-112

Base compose.yaml по-прежнему управляет только PostgreSQL. compose.app.yaml добавляет
один multi-stage image для api/worker/migrate, ожидание postgres healthy и migration
exit=0; compose.gate.yaml — **test-only** loopback dev identity.

Для существующего .env добавить CONTAINER_DATABASE_URL с теми же локальными
credentials/базой и URL-encoded password, но адресом postgres:5432. Host DATABASE_URL
остаётся 127.0.0.1:15432. Значения не передаются в build; .env не копируется в image.

```sh
pnpm docker:build
pnpm app:up
# После новых migrations пересобрать image и выполнить migrator перед новым API/worker:
pnpm app:migrate
pnpm app:down # volume сохраняется
```

Обычный app API: http://127.0.0.1:3000/health, API_PORT меняет только published port.
Business routes закрыты (production/dev actor off). NODE_ENV/HTTP_HOST/dev actor/admin
CLI заданы overlay явно, host .env не включает identity в контейнере.
Только isolated gate включает её через exec и loopback, не через внешний HTTP:

```sh
pnpm docker:image-check # no-cache clean context + canary scan всех final layers
pnpm docker:gate        # одноразовые project/volume, реальная приёмка/worker/SIGTERM
```

Gate создаёт собственный env tempfile 0600 и случайные localhost ports, не читает root
.env, не пишет в dev БД и удаляет только свой volume. Без Docker проверка падает.
Не передавать compose.gate.yaml при обычном app:up: gate не является production auth.
Backend filesystems read-only, USER node, cap_drop ALL, no-new-privileges и bounded
/tmp; node PID 1 получает SIGTERM напрямую, stop grace 20s > worker drain 15s.
Health API — liveness; pg health/migration — startup dependencies, постоянной DB
readiness и worker probe ещё нет. DB owner по-прежнему локальный admin; отдельные
production credentials/grants не provisioned. Не публиковать docker compose config /
inspect Env: runtime credentials доступны Docker-администратору.

Файлы, подробный build/startup/data/shutdown flow, ошибки и ограничения:
[Docker gate](../../docs/flows/docker-gate.md). Результаты:
[WMS-112](../../docs/reports/wms-112.md).
