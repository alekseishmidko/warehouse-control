# Локальный PostgreSQL

Compose-стенд WMS-101 содержит только PostgreSQL, а API запускается на host.
Конфигурация `compose.yaml` закрепляет PostgreSQL 17.9 bookworm по multi-arch digest,
named volume, healthcheck и host binding только `127.0.0.1:15432` по умолчанию.
Это локальный стенд, не production/HA-инсталляция.

## Запуск из корня репозитория

Для всего проекта в dev-режиме использовать `pnpm dev:all`: PostgreSQL запускается
из базового compose.yaml, API/worker/web работают на host с watch/HMR. Команда сама
применяет migrations. `Ctrl+C` сохраняет PostgreSQL и volume; `pnpm db:down` отдельно
останавливает БД. [Полный flow](../../docs/flows/dev-environment.md).
`pnpm app:up` — отдельный контейнерный backend в production mode, без frontend;
он требует HTTPS origin и свободный API_PORT. Он не заменяет dev:all.

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

С `.env.example` app API публикуется на http://127.0.0.1:4400/health:
`API_PORT=4400` задаёт только published port, внутри контейнера остаётся 3000.
`PORT=4400` задаёт отдельный host API для pnpm dev/dev:all. Одновременно запускать
host API и app:up на одном внешнем порту нельзя. dev:all сам направляет web proxy
на PORT; для отдельного web:dev задать `WEB_API_TARGET=http://127.0.0.1:4400`.
Business routes требуют настоящую session/warehouse role/CSRF. NODE_ENV/HTTP_HOST/dev actor/admin
CLI заданы overlay явно, host .env не включает identity в контейнере.
Только isolated gate включает её через exec и loopback, не через внешний HTTP:

```sh
pnpm docker:image-check # no-cache clean context + canary scan всех final layers
pnpm docker:gate        # одноразовые project/volume, реальная приёмка/worker/SIGTERM
```

Gate создаёт собственный env tempfile 0600 и случайные localhost ports, не читает root
.env, не пишет в dev БД и удаляет только свой volume. Без Docker проверка падает.
Не передавать compose.gate.yaml при обычном app:up: gate не отключает настоящую auth.
Backend filesystems read-only, USER node, cap_drop ALL, no-new-privileges и bounded
/tmp; node PID 1 получает SIGTERM напрямую, stop grace 20s > worker drain 15s.
Health API — liveness; pg health/migration — startup dependencies, постоянной DB
readiness и worker probe ещё нет. DB owner по-прежнему локальный admin; отдельные
production credentials/grants не provisioned. Не публиковать docker compose config /
inspect Env: runtime credentials доступны Docker-администратору.

Файлы, подробный build/startup/data/shutdown flow, ошибки и ограничения:
[Docker gate](../../docs/flows/docker-gate.md). Результаты:
[WMS-112](../../docs/reports/wms-112.md).

## WMS-202: обязательные auth настройки

Для app overlay задать оба срока seconds без числовых defaults.
CONTAINER_AUTH_ORIGIN необязателен, default https://warehouse.local. Host .env для pnpm dev может содержать loopback HTTP origin;
для browser login в Compose переопределить CONTAINER_AUTH_ORIGIN на адрес HTTPS gateway.
Overlay передаёт его приложению как AUTH_ORIGIN; host dev сохраняет свой HTTP origin. До внешней эксплуатации нужен TLS gateway,
backend сам TLS не завершает. Для изолированной демонстрации pnpm docker:gate использует
свой env, реальные bootstrap/login/grants и dev/test loopback HTTP. DEV_ACTOR_ENABLED=true
теперь отклоняет startup: это не способ включить бизнес-команды. [Флоу](../../docs/flows/identity.md).

## ENOSPC при установке dependencies в Docker

`ERR_PNPM_ENOSPC ... mkdir` может означать нехватку inode внутри Docker VM, даже если
на диске macOS и в Docker ещё есть свободные гигабайты. Inode — запись файловой
системы для файла/каталога. Проверять нужно и байты (`df -h`), и inode (`df -i`).
Если локальный backend image уже существует, выполнить read-only диагностику:

```sh
docker run --rm --pull=never --network none --read-only --entrypoint /bin/sh warehouse-backend:local -c 'df -h /; df -i /'
docker system df
docker buildx du --filter 'description~="warehouse/backend"' --verbose
```

В проверенном случае Docker VM имела 4,5 ГБ свободного места, но лишь около 21 тыс.
свободных inode из 3,9 млн. Следующая установка pnpm не могла создавать каталоги.
После освобождения ресурсов свободно около 17 ГБ и 1,3 млн inode. Адресный prune
ниже вернул `0 B`; нельзя приписывать ему всё изменение показателей VM.

Перед очисткой проверить список cache records. Адресная команда затрагивает только
описания нашего backend и записи, не использованные более суток:

```sh
docker buildx prune --filter 'description~="warehouse/backend"' --filter 'until=24h'
```

Фильтры объединяются через AND. У Buildx 0.23 значение regex с `/` и пробелами
передаётся с внутренними кавычками, как в примере. `Shared: true` означает общие
данные cache/image: удаление только cache metadata может освободить `0 B`.
По одному выводу `Reclaimable` нельзя обещать освобождение всех байтов или inode.
[Фильтры Buildx](https://docs.docker.com/reference/cli/docker/buildx/prune/).

Глобальный `docker system prune`, удаление volumes и Docker-wide очистка не входят
в диагностику проекта. Если места/inode всё ещё недостаточно, пересмотреть ненужные
образы в Docker Desktop и лимит виртуального диска в Settings → Resources → Advanced
→ Disk usage limit; [настройки Docker](https://docs.docker.com/desktop/settings-and-maintenance/settings/#resources).
После освобождения ресурсов повторить `pnpm docker:build`, затем `pnpm app:up`.
Успешная сборка не отменяет требования HTTPS origin для app overlay.

Повторная `pnpm docker:build` на проверенном окружении завершилась с exit 0:
обе frozen install стадии, Nest build и export image прошли. В ходе скачивания
встречались ECONNRESET/timeout с успешными retry; они не повторили ENOSPC.
