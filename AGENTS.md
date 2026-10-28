# Контекст и правила для агента

## Назначение

Warehouse Controller — учебная WMS: приёмка, размещение, резервирование,
сборка, отгрузка. Цель — практика транзакций, событий, конкурентного доступа,
наблюдаемости и эксплуатации в Kubernetes. Рабочий язык документации — русский,
идентификаторов и кода — английский.

## Сначала прочитать

1. `docs/README.md` — карта документации и статус проекта.
2. `docs/architecture.md` — границы модулей и потоки данных.
3. `docs/domain.md` — бизнес-инварианты.
4. `docs/contracts/README.md` — правила API и событий.
5. Принятые ADR в `docs/adr/` и текущий этап в `docs/roadmap.md`.

## Текущее состояние

Реализованы каркас NestJS (`GET /`, `GET /health`) и WMS-101: Compose PostgreSQL,
Drizzle/pg, baseline migration, runtime config и управление pool.
Есть pnpm workspace, build/typecheck и WMS-102: Jest unit/integration,
Supertest, изолированный PostgreSQL Testcontainers и cleanup fixtures/resources.
WMS-103 реализована: shared transaction port/context, PostgreSQL runner и audit module
с redaction и append-only migrations. WMS-104: минимальные catalog/warehouses/inventory,
int4 quantity, guarded receipt, immutable movement и dev fixtures CLI.
WMS-105: Ajv 2020-12/formats, code registry, shared EventContracts producer/handler
validation entrypoints, generated types/schema bundle и contract fixtures/limits.
WMS-106: OutboxService/Repository, migrations с aggregate counter, deliveries/streams,
immutable envelope и retention guards. WMS-107: HTTP boundaries, isolated dev actor,
idempotency storage и OpenAPI generation/diff. WMS-108: receiving draft/posted, HTTP create/post/get, parent lock и атомарное проведение.
WMS-109: worker entrypoint/claim/token/markers/cursors/retry/dead/shutdown protocol.
WMS-110: production inventory.putaway создаёт pending tasks+audit с atomic markers/cursors/ack.
WMS-111: local inspect/retry/signal, structured diagnostics, operator/reason audit/history и retry budget base.
WMS-112: multi-stage non-root Docker image API/worker/migrate, Compose overlays,
clean build/layers check и isolated Docker gate 1. Frontend, Kafka и Kubernetes ещё не реализованы.
Не считать наличие документации доказательством реализации.

## Обязательные ограничения

- Сохранять модульный монолит. API и worker — отдельные процессы одного backend.
- Сначала transactional outbox на PostgreSQL, затем Kafka. Outbox сохраняется.
- Остатки и резервы изменяет только `inventory` внутри транзакции.
- Бизнес-изменения, движения, аудит и outbox фиксируются атомарно.
- Доставка at least once; обработчики обязаны быть идемпотентными.
- Нельзя заменять надёжную доставку только EventEmitter или fire-and-forget.
- Не обещать exactly once, глобальный порядок событий или атомарность БД + Kafka.
- Не добавлять Redis/BullMQ, микросервисы или Event Sourcing без нового ADR.
- Не переносить ORM-модели и backend-классы в публичные контракты.
- Внешние побочные эффекты не выполнять внутри транзакции БД.
- Не редактировать уже применённые миграции; создавать новые.
- Не сохранять секреты, токены или реальные персональные данные в репозитории.

## Работа с изменениями

Менять только необходимое для текущей задачи. Не реализовывать весь roadmap
за один шаг. Для изменения архитектурного решения добавить ADR, связать
заменяющий ADR с предыдущим, обновить связанные документы.
Согласование документов не означает разрешение публиковать или разворачивать
проект во внешнем окружении.

При изменении API/событий обновлять схему, примеры и проверку совместимости.
При изменении поведения обновлять документацию вместе с кодом.
По умолчанию controller → service → repository, см. ADR-0009.
Controller отвечает за HTTP, service за сценарии/правила, repository за SQL/ORM.
Внутри модуля сервисы лежат в services/, репозитории в repositories/, DTO в dto/,
даже если файл пока один. Каталоги создаются с первым соответствующим файлом.
Модули экспортируют сервисы, repository остаётся внутренним provider;
прямые записи в чужие таблицы запрещены.
Не создавать обязательные domain/application/infrastructure/presentation слои
и отдельные interfaces/tokens для каждого класса. При необходимости выделять
сценарии, domain или ports локально с объяснением в README; значимые изменения — через ADR.

## Проверки

Существующие команды: `pnpm typecheck`, `pnpm build`.
`pnpm dev` запускает backend, `pnpm start` — собранный backend.
Jest: `pnpm test:unit` без Docker, `pnpm test:integration` с Testcontainers,
`pnpm test` — оба проекта; перед запуском production build и компиляция tests.
`pnpm test:config` — alias unit. Отдельный native `pnpm test:db-baseline`
перезапускает dev Compose postgres и не входит в Jest.
При недоступном Docker integration падает с ненулевым кодом, skip/fallback запрещены.
Test support — `apps/backend/test/support/`; отдельный контейнер на suite,
реальные migrations, config override через DI без изменения process.env.
Не запускать два test:prepare одновременно в одном checkout; suites одного Jest
прогона работают параллельно и имеют независимые БД.
Контрактные fixtures и generation diff проверяются локально в test:prepare/unit.
CI compatibility comparison ещё нет. Следующая задача — WMS-201 (уточнение складских правил).
При добавлении функциональности нужны проверки её бизнес-инвариантов.
Для outbox обязательны реальные PostgreSQL integration tests: rollback,
повторная доставка, конкуренция workers, восстановление после сбоя.
Не подменять их только моками. Отдельно сообщать, какие проверки не удалось выполнить.

## Завершение задачи

Указать, что изменилось, что проверено, какие ограничения остались.
Поддерживать фактический статус в `docs/README.md` и `docs/roadmap.md`.

## Документация и DRY — обязательные правила

Читать `docs/documentation-standard.md` и `docs/shared.md` перед изменениями.
Каждый backend-модуль, включая будущие shared/infrastructure, имеет README
по `docs/templates/module.md`: бизнес-раздел для менеджера и технический для разработчика.
README каждого модуля содержит схему взаимодействия и пошаговое движение данных:
вход/DTO, проверки и преобразования, вызовы сервисов/repositories, SQL/события,
результат, границы commit/rollback и ошибки. Добавлять синтетический пример
входа/выхода и ссылки на подтверждающие тесты; будущее отделять от реализованного.
Каждый исходный файл имеет file-level TSDoc/JSDoc; публичные символы — контракт,
ошибки и эффекты. Файлы без поддержки комментариев описывать в ближайшем README
и `docs/file-catalog.md`. Каждый новый собственный файл добавлять в каталог.
Generated artifacts описывать через генератор, не редактировать вручную.
Обновлять документацию одновременно с поведением; не оставлять TODO вместо неё.

Поясняющие JSDoc/TSDoc и комментарии пишутся на русском, включая CLI, Dockerfile,
Compose и тесты; идентификаторы и машинные контракты остаются на английском.
Применённые миграции и generated artifacts ради перевода не редактировать.
JSDoc/TSDoc и комментарии к работе кода обязательны при каждом добавлении или
изменении реализации, включая shared, infrastructure, CLI и test support.
Для классов, методов, функций и DTO описывать назначение, источник/доверие входных
данных, результат, ошибки и побочные эффекты; применять @param/@returns/@throws,
когда они проясняют контракт. Внутри нетривиальных алгоритмов объяснять этапы,
причины проверок, преобразование данных, конкуренцию/блокировки, идемпотентность,
владельца транзакции и границы commit/rollback. В тестах пояснять fault injection,
barriers, timeouts и проверяемый инвариант. Одного file-level комментария или README
для этого недостаточно. Не пересказывать очевидный синтаксис построчно и не
дублировать общие правила: давать ссылку на владельца контракта. Комментарии должны
описывать фактическое поведение и обновляться вместе с ним. Для generated code
править описание исходной схемы/генератора и регенерировать, не комментировать output вручную.

Для каждого добавляемого/изменяемого сценария подробно описывать флоу, в том числе
графически в Mermaid. Обязательны триггер, DTO/context и доверие входу, реальные
вызовы/преобразования/SQL, результаты и ошибки, границы процессов/commit/rollback,
промежуточное и итоговое состояние. Для сложного сценария разделять обзорный flowchart,
sequence и необходимые схемы состояний/гонок/сбоев/recovery/shutdown. Каждую существенную
ветку связывать с тестом/evidence; production/test-only/будущее явно подписывать.
README даёт флоу либо обзор со ссылкой на одного владельца подробностей в docs/flows;
не заменять исполнение схемой DI и не дублировать большой разбор. Формат —
docs/documentation-standard.md, пример — docs/flows/worker.md. Обновлять вместе с кодом.

Перед созданием утилиты искать существующий код через `rg`.
Переиспользуемую техническую логику выносить в `apps/backend/src/shared/<capability>/`;
код нескольких приложений — в packages при реальных потребителях.
Повтор бизнес-правила устранять через владельца домена, не переносом в shared.
Shared не импортирует модули или infrastructure. Адаптеры I/O — в infrastructure.
Не создавать utils-свалки, universal base service или абстракции только ради
похожего синтаксиса. При выделении общей логики проверять всех потребителей.

## Транзакции и аудит WMS-103

Сервис-владелец сценария вызывает TRANSACTION_RUNNER.run; вызываемые сервисы
получают тот же opaque TransactionContext. Infrastructure использует transactionClient.
Nested run, stale/cross-scope context запрещены. Все DB операции callback awaited;
fire-and-forget и внешнее I/O запрещены. Auto retry отсутствует, правила — docs/transactions.md.
Audit писать только через AuditService, с кодом основания и безопасными changes;
ошибка записи должна откатить сценарий. Runtime group warehouse_app имеет только
SELECT/INSERT audit; dev Compose по-прежнему admin, не production login.
Test cleanup вправе обходить trigger только внутри disposable harness БД.

## Складской baseline WMS-104

Количество: int4, MAX_STOCK_QUANTITY=2147483647. Приход 1..MAX, баланс 0..MAX,
0 <= reserved <= onHand. Проверки/schema/audit используют общий контракт.
Только InventoryService.receive изменяет stock, только в receiving location.
Guarded upsert, audit и immutable movement обязаны использовать один context.
OperationId уникален на одно движение: повтор отклоняется; HTTP dedup framework готов,
складские HTTP-команды подключены WMS-108.
Справочники вызываются через CatalogService/WarehousesService, не чужие repositories.
Dev fixtures: pnpm db:seed только development, новый набор без stock на каждый запуск.
Stock SQL/direct writes в tests допустимы только для проверки constraints;
cleanup отключает audit/movement triggers только в disposable container.
Draft event quantity уточнён до int4 до публикации. Runtime validation готова WMS-105.

## Контракты WMS-105

Source schemas — docs/contracts/events; generated TS/schema bundle в shared/events/generated
не редактировать вручную. pnpm contracts:generate и contracts:check; check входит в test:prepare.
Registry известного type/version и KnownEvent расширяются вместе со schema/fixtures.
prepareForOutbox возвращает проверенный message snapshot: OutboxService проверяет его
до INSERT в общей транзакции. parseForHandler вызывается до handler; неизвестные версии
не считаются успешной обработкой. Writer и worker protocol реализованы; invalid contract паркуется в dead, отдельной quarantine table нет.
ReceivingPosted: 1..1000 строк, quantity int4, <=262144 UTF-8 bytes с envelope/unknown fields.
MAX_RECEIPT_LINES берётся из generated schema, payload DTO — generated type alias;
receiving HTTP DTO использует эти limits. Unknown optional fields
сохраняются; coercion/defaults/field removal выключены. UTC требует Z, UUID — format.
Контракт не проверяет DB refs, права, duplicate lines или aggregateId=receiptId:
это ответственность ReceivingService WMS-108. Подробности — shared/events/README и ADR-0011.


## Outbox WMS-106

OutboxModule экспортирует writer OutboxService.append(context, AppendEventDto) и local OutboxRecoveryService.
Producer не задаёт eventId/aggregateVersion; writer создаёт UUID, preflight snapshot,
выделяет версию guarded upsert в outbox_aggregate_sequences и проверяет финальные bytes
через EventContracts до INSERT. JSONB сохраняется из проверенного message (смысл,
не whitespace/key order). Никаких run/commit/pool в writer. Ошибки append обязательно
выходят до runner: подавление после counter update может оставить пропуск версии.
Destination inventory.putaway зарегистрирован кодом и migration CHECK для полного receipt stream.
Stream создаётся cursor=0, существующие cursor/lease не сбрасываются; delivery pending.
Новые consumers требуют migration/replay/start-position плана, не простого редактирования массива.
Migrations 0005/0006 новые; events immutable, удаления всех четырёх outbox таблиц запрещены
до retention policy. Runtime events только SELECT/INSERT, остальным разрешён UPDATE;
DBA может обойти triggers. Test reset отключает их только в disposable container.
Worker/claim/dedup/retry/dead реализованы WMS-109, Kafka ещё нет; append повторно создаёт новый факт,
будущая повторная доставка использует сохранённый eventId, а не новый append.


## HTTP/idempotency WMS-107

Production graph включает public GET / и /health без prefix и receiving routes
/api/v1/receipts (create/get/post) под isolated dev actor; production auth нет. configureHttp до init
настраивает middleware/prefix api/v1/body limit; APP_PIPE/GUARD/FILTER — HttpModule.
Ошибки application/problem+json безопасны, correlation UUID валидируется/генерируется.
Dev actor default off: explicit NODE_ENV dev/test + DEV_ACTOR_ENABLED=true + server
DEV_ACTOR_ID UUID + loopback HTTP_HOST/peer, без proxy. Не доверять actor в body/headers.

ReceivingController использует HttpCommand(operation), CommandContext, class DTO validation
и HttpCommandsService.execute(scope,normalizedTargetAndBody,callback). Авторизацию проверить
до dedup на каждой попытке, state/business правила — внутри callback с общим context.
Сервис владеет одним run, nested run запрещён; callback без внешнего I/O. Scope PK
actorType/actorId/operation/UUID key, fingerprint SHA-256 canonical JSON без correlationId.
Повтор ждёт unique INSERT и читает сохранённый result отдельным read committed statement.
Result 200/201/202 JSON и relative Location, ошибки не кешируются; status/result/business/audit/
outbox атомарны. HTTP disconnect не отменяет commit: retry с тем же key. TTL/deletion нет.

Source OpenAPI — production controllers/DTO/decorators; docs/contracts/openapi.json generated
через pnpm openapi:generate, pnpm openapi:check сравнивает. Offline CLI не вызывает app.init,
не читает .env/БД. Test prepare включает diff после build. Swagger UI/CI comparison ещё нет.
Тестовый /api/v1/commands существует только в support fixture, не добавлять в production.
Новые migrations 0007/0008 не переписывать после применения. Следующая задача WMS-201.


## Receiving WMS-108

ReceivingModule экспортирует только ReceivingService; controller/services/repositories/dto.
Create draft: 1..MAX_RECEIPT_LINES, разные productId, int4 > 0, существующие товары и
receiving location своего склада. Состав неизменяем через API, edit/delete/cancel нет.
HTTP create/post используют HttpCommandsService.execute (один run), borrowed context
обязателен для receiving.create/post, inventory, audit, outbox. ReceivingService.get
открывает отдельный read run, не вызывать его в command callback.
Posting: SELECT receipt FOR UPDATE до проверки draft, строки inventory по productId,
operationId=line.id, receipt audit, один ReceivingPosted v1, финальный status и HTTP result.
Event aggregateId=payload.receiptId=receipt.id, postedAt=occurredAt, version=1.
Прежний key возвращает исходный response (create остаётся draft snapshot), новый key
на posted → 409. GET возвращает текущее состояние; post body отсутствует/{}.
Все routes требуют isolated dev actor, кроме технических GET; production auth/ACL нет.
Migrations 0009/0010 новые, после применения не менять. SQL guards/retention защищают
историю от runtime роли, DBA может обойти их. Не начислять stock в worker:
до обработки delivery pending/stream cursor=0/task нет, после WMS-110 task pending и delivery completed. SQL/HTTP proof — docs/receiving.md.
Receiving integration проверяет real locks и AFTER SQL fault injection каждого шага;
cleanup только disposable harness. Следующая задача WMS-201, business handler и local recovery готовы.


## Worker WMS-109

WorkerModule отдельный graph без AppModule/HTTP, entrypoint src/worker.ts, pnpm worker
после build/migrations. Registry production содержит ReceivingPostedHandler WMS-110: не заменять его fake no-op. WorkerService экспортируется,
WorkerRepository внутренний, config/DTO/services/repositories документированы.
Claim отдельным коротким run: только next version, stream/delivery SKIP LOCKED,
одинаковый UUID token/DB lease, attempts+1. Processing повторно lock/check token,
live lease/status/cursor, parseForHandler до handler, consumer cursor/marker validation.
Handler только awaited DB effects через владельцев, borrowed context, без nested run/I/O.
Effect/marker/consumer cursor/delivery cursor/completion — один commit. Активные locks
не дают reclaim после expiry; stale token не вправе ack/fail чужого claim.
После rollback отдельный token-checked failure run: safe error code, equal-jitter retry
или dead. Dead блокирует только свой поток, expired crash восстанавливается до budget.
MaxAttempts включает claim перед crash. Unknown contract permanent dead, без success marker.
Processed markers retained immutable, consumer cursor retained monotonic; DBA может обойти.
SIGTERM запрещает новый claim, interrupt poll, drain/close в общем deadline; hard exit=1.
PostgreSQL 17 transaction_timeout bound; CPU-blocking JS не прерывается timer и запрещён.
Config/defaults в worker README/.env.example, batch<=4 при pool=5. Migrations 0011/0012
после применения не менять. SIGTERM/SIGKILL и SQL faults проверять реальной БД/child processes.
Local recovery CLI готова WMS-111. Следующая задача WMS-201. Handler inventory.putaway использует
worker context/atomic markers, не повторяет receiving stock credit.


## Durable putaway WMS-110

Production ReceivingPostedHandler зарегистрирован как inventory.putaway в WorkerModule.
Он вызывает только InventoryService.createPutawayTasks(context,input); PutawayService и
PutawayRepository — private providers inventory. Нельзя снова вызывать receive/stock credit.
Одна pending task на sourceReceiptLineId, unique(eventId,lineId), composite source FK проверяют
posted receipt/event, warehouse/location и line/product/quantity. Source receiving keys добавлены
новыми migrations 0013 перед task schema 0014 и retention/grants 0015; applied SQL не менять.
Task/audit/marker/consumer cursor/transport cursor/completion — один worker commit. Direct
inventory repeat identical task возвращает прежнюю без audit; conflict permanent. Absent-key
INSERT race защищает unique, проигравший callback должен полностью rollback-нуть task audit.
Handler actorType system + фиксированный синтетический UUID из кода, correlation исходного event;
payload не выбирает actor. Нового outbox event/movement при планировании нет.
Consumer получает полный receipt stream. Будущие известные неинтересные type — no-op с marker/
cursor; сегодня KnownEvent только ReceivingPosted v1. Unit surrogate проверяет routing ветку,
не регистрирует новый контракт; unknown type/version по-прежнему dead до handler.
Task pending означает ожидание физического размещения, delivery completed — создание task.
Task execution/cancel/target location/API/UI ещё нет. Диагностика receipt → event → task:
docs/flows/putaway.md и docs/examples/putaway-result.sql, новый отчёт docs/reports/wms-110.md.
Test harness undefined handlers использует production registry, [] явно отключает его;
cleanup task immutable trigger только disposable admin DB. Source/task/audit/marker/crash
проверять реальными migrations/SQL/child SIGKILL до/после commit. Следующая задача WMS-201.


## Administrative recovery WMS-111

Local CLI: outbox:inspect/retry/signal, outbox:recovery-check — verified isolated runbook.
OUTBOX_ADMIN_ENABLED=false default; CLI до DB требует explicit dev/test и loopback DATABASE_URL.
Service дополнительно проверяет warehouse_outbox_admin membership, operator UUID утверждает
локальный вызывающий, не authenticated identity. Remote admin API/production auth нет.
OutboxRecoveryService/RecoveryRepository принадлежат outbox; не писать domain tables/markers/cursors.
Retry только один dead eventId+consumer, NOWAIT locks stream/delivery, live lease запрещён,
marker отсутствует, оба cursors=version-1, attempts ниже int4 max. Processing expired восстанавливает
worker, не admin. Audit/history/retry scheduling атомарны; не подавлять SQL/audit failure.
Total attempts монотонен. Worker budget/backoff = attempts-retry_attempt_base; admin устанавливает
base=attempts, history хранит прежние attempts/base/error/operator/reason/auditId. Envelope/eventId,
lastError, tasks/markers/cursors scheduling не сбрасывает. History retained immutable, runtime
warehouse_app не может менять budget base/insert recovery history, DBA способен обойти guards.
Inspect safe payload omitted либо opt-in validated preview 10 lines, no unknown fields/token;
общие diagnostic fields/safe error codes в shared/diagnostics. Worker NDJSON только после commit,
I/O sink не внутри transaction и не влияет на outcome. Signal local counts/thresholds, Node codes
0 healthy / 2 alert / 1 failure, внешние каналы отдельно WMS-401/402. Pino/Loki stack ещё нет.
Migrations 0016/0017 после применения не менять. Cleanup history trigger только disposable
admin harness. Runbook/fault/role/lease/cursor/race/rollback/CLI проверять реальным PostgreSQL.
WMS-112 завершена; следующая задача — WMS-201, без неявного remote deploy/публикации.


## Docker WMS-112

Один Dockerfile в apps/backend, root context allowlist .dockerignore, pinned Node 24.22.1
и pnpm 10.18.3, frozen full/prod installs в разных stages. Runtime только production
node_modules, dist, drizzle; .env/Git/host dist/test/node_modules не копировать.
Node PID 1, USER node; API/worker/migrate разные CMD одного image. Base compose.yaml
сохраняет postgres-only workflow; compose.app.yaml добавляет startup healthy/migrate
exit 0 dependencies. API default production, dev actor/admin false, localhost publication;
DB runtime остаётся local owner, production login/RBAC не provisioned. API /health liveness,
не continuous DB readiness; worker без health probe. Read-only rootfs, tmpfs /tmp, cap drop,
no-new-privileges; Compose grace 20s согласовывать с worker shutdown timeout.
Host DATABASE_URL loopback:15432, CONTAINER_DATABASE_URL postgres:5432; credentials runtime
не выводить через compose config/inspect Env. Root .env не переписывать ради Docker.
pnpm docker:build/app:up/app:migrate/app:down — обычные команды (down сохраняет volume).
pnpm docker:image-check — clean no-cache build и fake secret scan final layers.
pnpm docker:gate — отдельный wms112-UUID project/volume/env, actor только loopback через
exec, настоящие HTTP/SQL, restart и SIGTERM; cleanup только собственного disposable volume.
Не использовать compose.gate.yaml для внешнего доступа, guard не ослаблять ради demo.
Flow/evidence: docs/flows/docker-gate.md, docs/reports/wms-112.md. Следующая задача WMS-201.
