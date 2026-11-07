# Ревью всего проекта и пояснения YAML — 2026-11-07

## Findings

### R-01 — P2: worker принимает lease, истёкший во время ожидания row lock

Файл: [worker.repository.ts](../../apps/backend/src/infrastructure/worker/repositories/worker.repository.ts:136),
`WorkerRepository.lock`. Дефект **воспроизведён** на production repository и настоящем
PostgreSQL с применёнными migrations; это не вывод только из diff.

Триггер: claim ещё действует при начале SELECT; другая транзакция удерживает stream/
delivery locks, затем освобождает их без изменения строк уже после lease_until.
Выражение `lease_until > clock_timestamp()` находится в target list того же SELECT
FOR UPDATE. Оно успевает вычислиться до ожидания. Фактически lock вернул non-null,
хотя независимый запрос уже подтвердил истечение lease. Ожидается null/stale до handler.
Последствие: worker может начать обработку после утраты временного права на claim.
Этот reproducer не доказывает двойной commit или обход token rotation: они здесь не заявляются.

Воспроизведение: `node /tmp/wms-review-worker-lease.cjs` — exit0, диагностическая строка
`REPRODUCED R-01: real DB wait, lease expired before unlock, WorkerRepository.lock returned non-null`.
Скрипт использовал `createDatabaseHarness`, production OutboxService/WorkerService для
создания event/claim и настоящий WorkerRepository.lock, без подмены SQL протокола.

Порядок для regression test в `test/integration/worker.spec.ts`:

1. Создать event/claim production owners. Согласованно задать stream/delivery deadline
   по часам disposable БД на несколько секунд вперёд.
2. Вторым DB client открыть transaction и заблокировать обе строки FOR UPDATE без UPDATE.
3. Начать repository.lock в другом runner. Через pg_blocking_pids наблюдать настоящий wait.
4. Наблюдать истечение DB lease, затем commit blocker без изменения строк.
5. Ожидать null/stale и отсутствие handler effect/marker/ack. finally освобождает blocker,
   дожидается pending Promise и удаляет Testcontainers БД.

Направление исправления: сначала получить stream/delivery locks, затем новым statement
проверить token/status/cursor/deadline по свежим часам БД. Аналогичный подход уже есть в
`IdentityRepository.lockSessionAndReadValidity`. Существующий test «two concurrent
processors ... recheck state» проверяет изменённое completed состояние после ожидания,
но не истечение времени при неизменённых строках. Нужного regression test пока нет.
**Открыто:** поведение не менялось в рамках запроса на ревью.

### R-02 — P2: преждевременный Compose health — исправлено

Файл: [compose.yaml](../../infra/compose/compose.yaml:27). До исправления дефект **воспроизведён** на
закреплённом PostgreSQL17.9 image в отдельном контейнере и новом volume.

Триггер: первый старт пустого data directory. Image временно открывает Unix socket
для initdb, но ещё не TCP5432. `pg_isready` без `-h` сообщает success и Docker health
становится healthy. Зависимый migrate/host command уже может обратиться по TCP и
получить connection refused, хотя Compose startup dependency пропустила его.

Воспроизведение: `python3 /tmp/wms-review-postgres-health.py` — exit0:
`Docker health=healthy during initdb barrier; socket probe exit=0; TCP probe exit=2`.
Повтор использовал исходные interval2s/timeout3s/retries20/start_period5s.
Init script держал управляемый barrier; проверка наблюдала marker и реальный Docker
health, а не угадывала задержку sleep. Контейнер и только его anonymous volume удалены.
Первоначальный reproducer без исполняемого shebang не достиг barrier; исправлен
именно тестовый адаптер, затем воспроизведение повторено успешно.

Healthcheck исправлен: `pg_isready -h 127.0.0.1` проверяет основной TCP server, как
Kubernetes dev probe. Постоянный regression scripts/postgres-readiness.test.cjs упал
до изменения и прошёл после; он входит в check:pr и docker:gate. Проверка пароля,
grants и schema остаётся отдельным предусловием. Полные проверки — в разделе исправления ниже.

### R-03 — P3: устаревшая центральная документация — исправлено

Файлы: [domain.md](../domain.md:30), [domain.md](../domain.md:44),
[contracts README](../contracts/README.md:170), [root README](../../README.md:26).
Это подтверждённые расхождения документации с исходным кодом, а не runtime reproduction.

До исправления `domain.md` объявлял allocations ещё не реализованными и допускал ограниченный
повтор транзакции. Код содержит reservations/picking/shipping и runner выполняет
callback один раз без auto retry. Contracts README говорил об отсутствии frontend
api-client, хотя apps/web/src/api/client.ts использует generated OpenAPI types.
Root README оставлял Gateway следующим этапом при выполненной WMS-303.
Заменены устаревшие утверждения в root README, domain/contracts/architecture/operations,
карте документации и roadmap. Описаны действующие allocations/ledger, явный replay без
auto retry, server session вместо dev actor, generated SPA types и проверенный NGF/TLS.
Будущие Kafka/observability/external CI/HA и WMS-304 отмечены отдельно. Source DTO, SQL,
services, registry и identity validator сверены; новые бизнес-правила не вводились.
Исторические reports не переписывались под новый результат.

### R-04 — P3: advisories в development dependency tree

Файлы: [pnpm-lock.yaml](../../pnpm-lock.yaml:2697), root/apps/backend package manifests.
`pnpm audit --prod --json` вернул exit0: 143 production dependencies, известных
advisories нет. Полный `pnpm audit --json` вернул **exit1**: 1029 dependencies,
5 moderate и1 low совпадений, четыре уникальных advisory. Это результат registry
scan, а не воспроизведённая эксплуатация приложения.

| Пакет в lockfile       | Dependency path                                         | Advisory / условие                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| esbuild0.18.20         | drizzle-kit → @esbuild-kit/esm-loader → core-utils      | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99): уязвим serve mode; использование этого serve mode проектом не установлено                |
| deepmerge4.3.1         | @nestjs/cli → fork-ts-checker-webpack-plugin            | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): prototype poisoning при недоверенном merge input; такой input в проекте не воспроизведён |
| glob13.0.6 и10.5.0     | @nestjs/cli; testcontainers → archiver → archiver-utils | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4): обход отмены filesystem traversal; недоверенный путь к toolchain не показан              |
| minimatch10.2.6 и9.0.9 | eslint; testcontainers → archiver → glob                | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): amplification недоверенного pattern; эксплуатируемость данного flow не доказана          |

Направление: проверить обновление родительских dev tools с поддерживаемыми ranges и
повторить frozen install/build/tests/audit; отдельно оценить reachability. Не применять
слепой override несовместимой major версии ради нулевого audit. Наличие advisory не
приравнивается к доступному через API exploit. **Открыто:** dependencies/lockfile не менялись.

## Область и способ проверки

Обзор выполнен на полном текущем checkout, включая ранее существовавшие файлы и
незакоммиченную WMS-303. Diff использован для контроля сделанных комментариев,
а не как граница поиска дефектов. Карта просмотра:

| Область                | Проверенные связи и файлы                                                                                                                               | Evidence / предел                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Архитектура/модули     | App/HTTP/worker graphs, module exports/imports, shared boundaries; catalog/warehouses/audit                                                             | Ручное чтение сервисов/контроллеров плюс architecture/lint на всём TypeScript source; это не доказательство отсутствия любых дефектов каждой строки |
| Identity/HTTP          | AuthGuard, configureHttp, identity.http, auth/access/sessions services, identity repository, password/secrets/config                                    | Session actor, default deny, exact Origin/CSRF, no forwarded actor, user→session locks; negative/integration tests в check:pr                       |
| Транзакции/idempotency | PostgresTransactionRunner, HttpCommandsService/repository, controller authorize callbacks                                                               | Один borrowed context, ACL до replay, atomic saved result, ошибки без auto retry                                                                    |
| Склад/fulfillment      | ReceivingService/controller; InventoryService, putaway, reservations, picking-stock, shipping-stock repositories; fulfillment/picking/shipping services | Наблюдён порядок parent/stock locks, absent-key insert, limits, allocation history, audit/outbox; отдельный proof всех interleavings не выполнен    |
| SQL/storage            | Schema CHECK/FK/grants, журнал migrations, guards allocations/shipping/immutable draft; actual migrations в harness                                     | Applied/generated SQL не редактировались; DBA bypass/HA/restore не испытаны                                                                         |
| Outbox/worker/recovery | Writer, WorkerService/Loop/Process/Repository, recovery service/repository, serialized migrator                                                         | R-01 воспроизведён; lease fencing, marker/cursors и recovery границы проверены по коду/существующим tests                                           |
| SPA                    | ApiClient, SessionProvider, CommandJournal, query keys/cache, workspace/pages/recovery/static server                                                    | Неизвестный исход сохраняет key; per-user/warehouse scope; browser flow в gateway gate; Safari/Firefox/полный WCAG не проверены                     |
| Infrastructure/scripts | Все собственные YAML, Dockerfiles/.dockerignore, dev-all, Docker/kind/gateway/image/quality scripts                                                     | Semantic before/after YAML/render comparison и запуск пользовательских entry points                                                                 |
| Тесты/контракты        | Unit/integration fixtures/harness/barriers, source event schemas, registry/generated OpenAPI/client, coverage guards                                    | check:pr на всём проекте; зелёный existing suite не закрывает R-01/R-02                                                                             |
| Документация           | Root/module README, карта/план/ADR/contracts/domain, owners flows/reports                                                                               | R-03; не выполнен построчный редакторский аудит всех исторических reports                                                                           |

Отдельный security pentest, fuzzing всех HTTP/SQL inputs, fault injection каждого
системного вызова и доказательство всех конкурентных расписаний не выполнялись.
Scope покрытия кода и scope выполненного review различаются.

## Требования к этому изменению

Вход: существующие YAML и исходный код проекта; комментарии не являются доверенным
контрактом без сверки с реализацией. Права: локальное чтение/проверки и правка пояснений;
изменение бизнес-поведения, applied migrations, Secrets, .env и рабочих volumes вне задачи.
Успех: findings с evidence, подробные русские комментарии, неизменная конфигурация и
проверенные затронутые entry points. Ошибки проверки фиксируются, а не превращаются в skip.

| AC           | Изменение                                                       | Проверка                                                              |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| AC-REVIEW-01 | Обзор всех подсистем, не только diff; findings R-01–04          | Карта выше, реальная БД/контейнер для R-01/R-02, полный quality gate  |
| AC-YAML-01   | Комментарии всех15 собственных YAML                             | Инвентаризация ниже и повторное чтение каждого файла                  |
| AC-YAML-02   | Никаких изменений parsed YAML values/manifests/checksum         | Снимок до правок, deep equality после; base и gateway render profiles |
| AC-YAML-03   | Generated lockfile сохранён, его устройство описано у владельца | README/workspace comments и equality lockfile; frozen install         |
| AC-YAML-04   | Затронутые команды действительно запущены                       | Результаты команд ниже, readiness/cleanup подтверждаются gate         |

## Инвентаризация YAML

В checkout16 YAML, включая pnpm-lock.yaml. node_modules, Git и build outputs не входят
в собственные исходники. Добавлены причины настроек и порядок работы рядом с блоками:

| Файл                                 | Что объяснено                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| pnpm-workspace.yaml                  | Выбор workspace, allowed dependency scripts, связь с generated lockfile                    |
| infra/compose/compose.yaml           | Env/initdb, project isolation, loopback ports, volume lifetime, health и R-02              |
| infra/compose/compose.app.yaml       | Merge anchors, migrator→API/worker, shared image, env/security/limits/drain                |
| infra/compose/compose.gate.yaml      | Test-only override, isolated driver, loopback и сохранение настоящей auth                  |
| infra/kubernetes/postgres-dev.yaml   | Service→StatefulSet→PVC/initdb/TCP readiness, Secret refs, resources и cleanup             |
| infra/helm/warehouse/Chart.yaml      | Metadata/version/type, schema/render/hooks, platform dependencies отдельно                 |
| infra/helm/warehouse/values.yaml     | Merge order, обязательные policy/digest/Secrets, resource units, optional Gateway/web      |
| infra/helm/warehouse/values-dev.yaml | Несекретный dev overlay, origin port, предварительный kind load                            |
| templates/accounts.yaml              | Runtime/hook SA, hook weights, отсутствие API token/RBAC                                   |
| templates/configmap.yaml             | Несекретная policy, env snapshot, checksum rollout, helper для pre-install                 |
| templates/deployments.yaml           | Два процесса одного artifact, rollout/labels, UID/seccomp/read-only/tmpfs, предел probes   |
| templates/migration.yaml             | Revision identity, advisory serialization, retries/deadline, recovery и Secret isolation   |
| templates/service.yaml               | ClusterIP/selector/targetPort и разделение внутреннего/внешнего HTTP                       |
| templates/web.yaml                   | Отдельный static artifact, readiness index, отсутствие API proxy и DB credentials          |
| templates/gateway.yaml               | CRDs/NGF→TLS Secret→reconcile, listeners/routes, prefix, redirectPort, trust boundaries    |
| pnpm-lock.yaml                       | Generated, не редактировался; importers/packages/snapshots/integrity описаны в root README |

Комментарии Helm ConfigMap размещены без добавления rendered whitespace: checksum
зависит от текста template output, поэтому даже лишняя пустая строка вызвала бы rollout.
Первая semantic comparison это обнаружила; комментарии переставлены без изменения
runtime values. Повторное сравнение подтвердило equality, включая checksum/config.
Это исправление способа документирования, не refactor приложения.

## Проверки исходного ревью, до исправления R-02/R-03

Окружение: macOS arm64, Node24.19.0, pnpm10.18.3, Docker Desktop; закреплённые CLI
из WMS-301. Все Docker/DB/cluster checks используют собственные disposable ресурсы.
Root .env и рабочие данные не редактировались. Ранний frozen install в sandbox
получил NO_TTY при недоступном store; тот же entry point с доступом к существующему
store завершился exit0, lockfile up to date, dependencies already up to date.

- `pnpm install --frozen-lockfile` — exit0.
- `node /tmp/wms-review-yaml.cjs compare` — exit0: parsed YAML/lockfile и rendered
  base/gateway объекты совпадают с состоянием до комментариев, включая config checksum.
- R-01/R-02 reproducers — exit0, дефекты подтверждены; это не прохождение ожидаемой
  исправленной regression policy.
- `pnpm db:up`, `pnpm app:migrate`, `pnpm app:up`, `pnpm app:down`, `pnpm db:down` — exit0
  через штатные root scripts с теми же arguments. Изоляция задана COMPOSE_PROJECT_NAME,
  synthetic env credentials, POSTGRES_PORT/API_PORT=0; root .env не редактировалась.
  После --wait API /health=200, anonymous /api/v1/warehouses=401. Собственный volume удалён.
- `pnpm check:pr` — exit0: 578 backend tests/40 suites, 37 web tests/4 files, static
  server test, Chromium, typed lint/architecture, contracts/OpenAPI/API generation,
  typecheck/build и оба coverage guards. Backend: lines/statements90.54%, branches94.50%,
  functions89.78%; web: lines62.20%, statements57.77%, branches72.36%, functions52.81%.
  Baselines не менялись. Child-process CLI/browser/CJS server coverage не объединяется
  с Jest/Vitest. Зелёный existing suite не проверяет R-01/R-02 и не закрывает findings.
- `pnpm audit --prod --json` — exit0; `pnpm audit --json` — exit1, детали R-04.
- `pnpm docker:image-check` — exit0: clean no-cache backend build, canary scan всех
  финальных image layers, безопасный image config/non-root entrypoint.
- `pnpm docker:gate` — exit0: receipt/putaway/reserve/replay, restart PostgreSQL,
  штатный API/worker SIGTERM (оба exit0), очистка своего project/volume.
- `pnpm kubernetes:gate` — exit0: lint/template, actual install/upgrade/uninstall,
  migration/config negative cases/recovery, delayed DB и PVC persistence.
- `pnpm gateway:gate` — exit0: те же Kubernetes проверки плюс pinned CRDs/NGF,
  HTTPS CA+hostname, redirect/prefix/cookies/Origin/CSRF/oversize/spoof checks,
  Chromium receive10→putaway→reserve/pick/ship3→stock7, unknown routes/upstream failure.
  Chromium применяет ephemeral leaf SPKI pin; отдельный HTTPS client проверяет CA+SAN.
  Системное доверие браузера к dev CA не устанавливалось.
- `pnpm format:check`, `git diff --check` и повтор semantic YAML/render comparison — exit0.

Оба Kubernetes entry points использовали overrides:

```sh
export WMS_KIND=/tmp/wms301-tools/kind033
export WMS_KUBECTL=/tmp/wms301-tools/kubectl137
export WMS_HELM=/tmp/wms301-tools/helm322/darwin-arm64/helm
export WMS_GATEWAY_CRDS=/tmp/wms303-gateway-crds.yaml
pnpm kubernetes:gate
pnpm gateway:gate
```

CRD input проверяет закреплённый SHA256; это явный dependency cache, не skip.
Негативные templates/upgrades печатают ожидаемые ошибки; итоговые gate exit codes0.
После finally проверено отсутствие оставшихся kind clusters и Compose containers
с созданными этим review префиксами.

## Повторное ревью и открытая работа

Комментарии сверены с фактическими settings, hooks и code owners; не добавлены
фиктивные worker/readiness probes, автоматический schema rollback, HA или exactly-once.
Для generated lockfile действует документация у владельца. Функциональные findings
R-02/R-03 исправлены по отдельному поручению, детали ниже. Открыты R-01 (worker lease)
и R-04 (совместимое обновление dev dependency tree). WMS-304 и следующие roadmap stages этим review не выполнены.

## Исправление R-02/R-03: требования до изменения

Поручение: исправить только Compose TCP readiness и устаревшие центральные документы.
Вход — недоверенная готовность временного initdb server, существующий Compose env и
актуальные source/flows. Оператор запускает local dev с явными credentials. Успех:
--wait остаётся pending до TCP5432, затем startup/migrations/API/worker работают;
документация описывает текущее состояние без dev actor и auto retry. Root .env,
рабочие volumes, applied migrations, worker lease и dependency versions вне изменения.

| AC        | Реализация                                                                | Проверка                                                                                                                 |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| AC-R02-01 | pg_isready через TCP127.0.0.1                                             | scripts/postgres-readiness.test.cjs: initdb barrier, реальный health probe, pending --wait; после release healthy и TCP0 |
| AC-R02-02 | Обычные root db/app entry points и shutdown                               | pnpm db:up/app:migrate/app:up/app:down/db:down на отдельном UUID project; Docker gate                                    |
| AC-R03-01 | Domain/contracts/root/status/architecture/operations согласованы с source | Ручная сверка владельцев и ссылок; поиск прежних противоположных утверждений; без фиктивных текстовых unit tests         |

До исправления новый regression test завершился exit1: health действительно стал
healthy во время initdb barrier. Проверка основана на новой записи Docker health log,
а не на предположении о длительности startup. После исправления тот же test прошёл.

### Ревью исправления и окончательные проверки

Повторное ревью охватило production health command, зависимости Compose, отказные
и успешные ветки нового test, наблюдение health log, ожидание child process и
finally cleanup. Test использует исходные image/health timings из base Compose;
временный overlay добавляет только управляемый initdb script. Credentials идут через
env-file0600; UUID project/volume исключают затрагивание рабочих данных.

В документации сверены schema/DTO/controllers, EventContracts registry, auth validator,
transaction runner, allocations/picking/shipping services и существующие Helm resources.
Устаревшие утверждения заменены на месте. Исходный проект WMS-201 явно отличён от
реализованных WMS-204–206; исторические reports сохраняют прежний контекст. Целевые
требования Kafka/telemetry/CI сохранены как будущие, не объявлены работающими.
Локальные ссылки семи центральных документов проверены; broken paths не обнаружены.

| Команда / проверка                                                                    | Результат после исправления                                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm test:postgres:readiness                                                          | exit0,1 test. До изменения того же health command — exit1 с преждевременным healthy                                                     |
| pnpm db:up                                                                            | exit0 на новом изолированном volume                                                                                                     |
| pnpm app:migrate                                                                      | exit0, штатный migrator                                                                                                                 |
| pnpm app:up                                                                           | exit0 через штатный script с --build --wait api worker                                                                                  |
| npm run app:up                                                                        | exit0 через исходный npm entry point с теми же arguments                                                                                |
| API после --wait                                                                      | /health200, anonymous /api/v1/warehouses401                                                                                             |
| pnpm app:down; pnpm db:down                                                           | Обе команды exit0; тестовый project/volume затем удалён адресно                                                                         |
| pnpm docker:image-check                                                               | exit0: clean no-cache build, canary scan всех final layers, безопасный config/non-root                                                  |
| pnpm docker:gate                                                                      | exit0: новый regression, приёмка/размещение/резерв/replay, PostgreSQL restart, API/worker SIGTERM оба exit0                             |
| pnpm check:pr                                                                         | exit0: новый regression,578 backend tests/40 suites,37 web tests/4 files, static server test, PostgreSQL/Chromium и оба coverage guards |
| YAML/render comparison                                                                | Единственная ожидаемая config delta — TCP health command. Остальные parsed YAML, lockfile и base/gateway rendered profiles совпали      |
| pnpm format:check; node --check scripts/postgres-readiness.test.cjs; git diff --check | exit0                                                                                                                                   |

User commands выполнялись с COMPOSE_PROJECT_NAME=wms-review-<UUID>, synthetic
POSTGRES_* / CONTAINER_DATABASE_URL, POSTGRES_PORT=0/API_PORT=0 и явными session
settings. Root .env не менялась, root scripts/arguments не заменялись вложенными
проверками. Исходные commands действительно запущены, только storage/ports изолированы.
После cleanup проверено отсутствие оставшихся тестовых контейнеров/volumes.

Backend coverage неизменён: lines/statements90.54%, branches94.50%, functions89.78%;
web: lines62.20%, statements57.77%, branches72.36%, functions52.81%. Baselines не
понижены. Node/CJS Compose regression проверяется функционально и не выдаётся за
объединённое Jest/Vitest coverage. WMS-304/HA/external deployment не проверялись этим
исправлением; Helm rendered profiles сверены без повторного Kubernetes install,
поскольку их resources/config не менялись. R-02/R-03 закрыты; R-01/R-04 остаются открытыми.
