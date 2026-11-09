# Система контрактов

## Источники истины

| Контракт         | Источник                                                       | Потребитель                          |
| ---------------- | -------------------------------------------------------------- | ------------------------------------ |
| HTTP API         | NestJS DTO + runtime validation + OpenAPI decorators           | Web и интеграции                     |
| Документ OpenAPI | Генерируется из приложения, локальный diff check; CI предстоит | Генератор типов и transport apps/web |
| События          | Версионированные JSON Schema в этой директории                 | Workers и Kafka consumers            |
| Типы событий     | Генерируются из JSON Schema                                    | Backend и consumers                  |
| Данные БД        | SQL/Drizzle migrations                                         | Только backend                       |

TypeScript-типы сами по себе не валидируют вход. События проверяются по JSON
Schema перед записью outbox и на границе consumer. WMS-105 реализует общий
EventContracts с prepareForOutbox/parseForHandler, registry, runtime validator
и генерацию event types. Writer подключён WMS-106, OpenAPI generation WMS-107; consumer inventory.putaway реализован WMS-110.
Дублировать вручную одинаковые DTO в frontend запрещено.

## HTTP API

Настроен бизнес-префикс `/api/v1`; технические `/`, `/health` и `/health/startup|ready|live` остаются
каркасными маршрутами. Не документировать будущие endpoint как работающие.
JSON использует camelCase, идентификаторы — UUID, время — UTC RFC 3339.
Списки: cursor pagination с фиксированным стабильным порядком и максимальным limit.

Ошибки: `application/problem+json`, поля `type`, `title`, `status`, `detail`,
`instance`, расширения `code`, `correlationId`, при необходимости `errors`.
Стабильный `code` предназначен для клиента; stack trace наружу не выдаётся.
Коды: 400 — некорректный ввод; 401/403 — доступ; 404 — отсутствие;
409 — конфликт состояния, версии или ключа идемпотентности;
422 — недопустимые refs/количества/зоны или overflow; недостаточный свободный остаток даёт409 INSUFFICIENT_STOCK.

Для команд с побочными эффектами обязателен `Idempotency-Key`.
Уникальность: `(actorType, actorId, operation, key)`; сохраняем hash нормализованного запроса
и результат успешной операции в её транзакции. Тот же ключ и другой запрос → 409.
Параллельный повтор сериализуется уникальным ограничением; успешный повтор
возвращает прежний результат. Записи сохраняются без TTL; удаление требует отдельной retention policy. Идемпотентность HTTP и consumer — разные механизмы.

Запись защищена проверкой server session, ролей и доступа к фактическому складу на backend.
С WMS-202 business routes требуют server session, CSRF для unsafe и warehouse permission.
`actorId` берётся из доверенного auth context, а не из пользовательского body.
Входящие correlation IDs проверяем по формату и длине либо создаём новые.

## События

Имя: `<context>.<fact>` в прошедшем времени, пример `receiving.receipt-posted`.
Внутренние события не являются инструкциями consumer изменить исходный остаток.
Команды именуются отдельно и не маскируются под факты.

Обязательный конверт:

| Поле                        | Правило                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| eventId                     | UUID, неизменен при всех повторах и переходе на Kafka                                         |
| type / schemaVersion        | Тип факта и целая major-версия схемы                                                          |
| aggregateType / aggregateId | Агрегат, определяющий порядок                                                                 |
| aggregateVersion            | Последовательность опубликованных событий этого агрегата, от 1                                |
| occurredAt                  | Время бизнес-факта UTC                                                                        |
| correlationId               | Идентификатор сквозного сценария                                                              |
| causationId                 | UUID породившего события; отсутствует для корневой HTTP-команды                               |
| traceparent                 | Необязательная строка до512 символов; сейчас проверяются тип/длина, W3C/OTel — отдельный этап |
| payload                     | Данные по схеме типа и версии                                                                 |

`aggregateVersion` выделяется атомарно с блокировкой/версией агрегата и не имеет
пропусков среди его событий. Одна версия — одно событие. Если позже понадобятся
несколько событий одной бизнес-версии, потребуется отдельный sequence и ADR.
Consumer, зависящий от порядка, подписывается на полный поток этого агрегата.

Пример: [схема](events/receiving.receipt-posted.v1.schema.json),
[сообщение](examples/receiving.receipt-posted.v1.json).
Событие содержит фактические строки приёмки, но не ORM-сущности, секреты
или произвольные персональные данные. Первый документ содержит 1..1000 строк,
quantity — integer 1..2147483647. Всё сообщение ограничено 262144 байт (256 КиБ)
JSON UTF-8, включая envelope и неизвестные поля. Большой документ разделяют
до проведения; автоматического дробления событий нет. Пределы уточнены до
первой публикации v1; дальнейшее сужение опубликованной версии — breaking change.

Payload DTO берётся из generated ReceivingPostedV1, а MAX_RECEIPT_LINES — из
generated schema. Receiving HTTP DTO WMS-108 уже использует эти limits;
create/post/get подключены с session/warehouse ACL WMS-202. Existing ReceiveStockDto принимает одну строку
и использует тот же int4 quantity contract. Проверка UUID/UTC/quantity не заменяет
проверку прав, существования справочников, уникальности строк или состояния документа.

## Совместимость

- Producer владеет схемой, но изменение проверяет с consumers.
- В рамках версии допускаются только необязательные новые поля, сохраняющие смысл.
- Consumers игнорируют неизвестные поля; схемы не запрещают дополнительные поля.
- Удаление/переименование поля, смена типа, обязательности или смысла → новая major-версия.
- Новое значение enum потенциально ломает consumers; требует отдельной проверки.
- На переходе consumers должны понимать старую и новую версии; producer переключается после них.
- Неизвестный тип/версия попадает в диагностику/карантин, не считается успешным бизнес-действием.
- Старые события не переписываются при replay; преобразование делается явным upcaster.

Перед Kafka добавим AsyncAPI с топиками, ключами и группами, а существующие
JSON Schema подключим к Registry после проверки поддерживаемого dialect.
Схемы в Git остаются первичным источником; Registry — проверяемая публикация.

## Реализованные локальные проверки WMS-105

Ajv 8.20.0 (`ajv/dist/2020`) + ajv-formats 3.0.1 full, strict без coercion,
defaults и удаления полей. Локальный registry поддерживает receiving.receipt-posted:1.
Полный envelope/payload проверяется перед возвратом producer snapshot и до допуска
handler caller. Неизвестная версия — UNSUPPORTED_EVENT, invalid payload — INVALID_EVENT,
неразбираемый JSON — INVALID_JSON, превышенный размер — MESSAGE_TOO_LARGE.
OutboxService WMS-106 проверяет envelope до INSERT в общей транзакции и сам выделяет
eventId/aggregateVersion; producer не вправе передавать эти поля. Worker validation
подключена WMS-109, реальный inventory.putaway handler — WMS-110.

`pnpm contracts:generate` создаёт TS types и runtime schema bundle из исходных JSON,
`pnpm contracts:check` проверяет точное совпадение без изменения checkout.
`pnpm test:unit` проверяет исходный пример, [отдельные fixtures](fixtures/README.md),
formats, required fields и limits; test:prepare включает generation check.
Generated artifacts коммитятся вместе со схемами; ручное редактирование запрещено.
Порядок изменения: schema → generate → registry/KnownEvent при новой версии → fixtures →
check/tests. Команды не требуют Docker/БД. При двух реальных приложениях типы/capability
переедут из backend shared в packages; сейчас второй потребитель не создан.

Настройка, точное движение данных, ошибки и ограничения генератора:
[shared events README](../../apps/backend/src/shared/events/README.md),
[ADR-0011](../adr/0011-event-contract-validation.md).

## Локальные gates и будущая внешняя CI

1. Схемы и примеры валидны по JSON Schema 2020-12 с проверкой formats.
2. Генерация типов и OpenAPI воспроизводима, нет незакоммиченного diff.
3. OpenAPI и event schemas проходят breaking-change comparison с основной веткой.
4. Producer/consumer tests покрывают старые fixtures и неизвестные поля.
5. Интеграционные проверки подтверждают бизнес-эффект и дедупликацию.

Локальные проверки schemas/fixtures/event generation и OpenAPI generation diff уже есть; CI workflow,
сравнение breaking changes с основной веткой ещё нет; consumer business integration готова WMS-110.

## Уточнение quantity WMS-104

Неопубликованная receiving.receipt-posted v1 schema теперь задаёт quantity
как integer 1..2147483647, согласованно с SQL int4 и service/audit validation.
Старый MAX_SAFE_INTEGER снят только с quantity, не aggregateVersion.
Это ограничение принято до первой v1 реализации и используется production writer/worker.
Будущее несовместимое сужение опубликованной схемы потребует новой major-версии.
Unit stock-quantity.spec.ts сверяет общий int4 contract, а event-contracts.spec.ts
теперь проверяет этот диапазон полноценным runtime validator WMS-105 на обеих границах.

## Реализованные HTTP boundaries WMS-107

ValidationPipe использует class-validator/class-transformer без implicit conversion,
с whitelist/forbidNonWhitelisted. Ошибки application/problem+json имеют статические
code/detail, pathname instance без query и UUID correlationId; исходный exception,
SQL, stack и payload не выдаются. Старые plain service errors безопасно дают 500,
новые бизнес-ошибки отображаются явно, не по error.message.

X-Correlation-Id — optional UUID: отсутствует → server UUID, некорректен → 400 и новый
UUID ответа. Для команд Idempotency-Key обязателен и является UUID. Нормализованный
request включает target/path params и body, исключает correlationId/технические headers.
Scope уточнён до actorType/actorId/operation/key; operation и actor задаются сервером.
Один нормализованный hash → сохранённый 200/201/202 JSON body и relative Location;
другой → 409. Ошибки не кешируются, pending/result/business/audit/outbox фиксируются
одним run. Нет TTL до отдельной retention policy. Client timeout не доказывает rollback:
повторять тот же ключ. Авторизация выполняется до replay на каждом запросе.

Dev actor удалён. DEV_ACTOR_ENABLED=true отклоняет startup также в dev/test; body/headers не задают actor.
Server session/CSRF/warehouse ACL обязательны до replay каждой бизнес-команды. Только технические GET public.

[openapi.json](openapi.json) — generated из production controllers, не править вручную.
Команды `pnpm openapi:generate` / `pnpm openapi:check` выполняют build, затем offline CLI
без .env/DB init/listener; test:prepare включает diff check после build. Paths содержат действующие auth/admin, receiving/putaway/order/picking/shipping и warehouse read routes.
Примеры приёмки — [receiving](../receiving.md). Swagger UI не добавлен.
Типы SPA генерирует openapi-typescript в apps/web/src/api/generated/schema.ts;
ApiClient в apps/web/src/api/client.ts выполняет same-origin запросы. Команды
`pnpm web:api:generate` / `pnpm web:api:check`, [web README](../../apps/web/README.md). Подробности/ограничения:
[HTTP](../../apps/backend/src/infrastructure/http/README.md),
[idempotency](../../apps/backend/src/infrastructure/idempotency/README.md),
[ADR-0013](../adr/0013-http-idempotency.md).

## Receiving HTTP WMS-108

[OpenAPI](openapi.json) содержит POST /api/v1/receipts (201 + Location),
POST /api/v1/receipts/{receiptId}/post (200), GET /api/v1/receipts/{receiptId} (200).
Commands: UUID Idempotency-Key; post body отсутствует либо {}. Actor только server-side.
Create DTO: warehouseId/receivingLocationId UUID, lines 1..1000, productId UUID,
quantity integer 1..2147483647, без неизвестных полей. Duplicate product — 422.
ReceiptDto отделён от Drizzle: id, склад/ячейка, status draft/posted, UTC createdAt,
nullable postedAt/postedEventId, lines с id/position/productId/quantity.
Прежний create key возвращает первоначальный draft snapshot; текущее состояние — GET.
[Примеры и коды отказа](../receiving.md), [ADR-0014](../adr/0014-receiving-vertical-slice.md).

## Consumer inventory.putaway WMS-110

Первый ReceivingPosted handler создаёт одну immutable pending task на source receipt line
через публичный inventory API. Task/audit/marker/cursors/completion атомарны, stock/movement
повторно не создаются. Контракт ReceivingPosted v1 не менялся; source ids/quantity/limits
используются из существующей schema. Создание task выполняет worker; GET/execute task HTTP routes и output schema подключены WMS-203.
Registry знает ReceivingPosted, PutawayCompleted, OrderChanged, PickingProgressed и ShippingChanged. Receipt stream получает
inventory.putaway, агрегаты putaway-task/order пока без подписчиков. No-op unit использует
реально валидированный PutawayCompleted, а не surrogate неизвестного контракта. Unknown type/version
по-прежнему permanent dead до handler. [Схемы и диагностика](../flows/putaway.md).

## Fulfillment: исходные требования и реализованные контракты

[Исходный проект WMS-201](fulfillment.md) и [исходные AC](../flows/fulfillment.md)
сохранены как требования до реализации. Order/reservation/picking/shipment реализованы
WMS-204–206 и включены в generated OpenAPI; source DTO/controllers и соответствующие
flows ниже описывают действующие пути/статусы/лимиты. B1–B4 приняты2026-10-29.
Int4 quantities, ReceivingPosted262144 UTF-8 bytes и1..1000 строк сохранены.
Breaking change опубликованной схемы требует новой версии и migration/replay плана.

## Направление auth WMS-202

Приняты логин/пароль и серверная сессия, а также threat assumptions, см.
[ADR-0018](../adr/0018-server-sessions.md) и [identity](../identity.md). Auth endpoints, DTO, cookie/CSRF policy и permissions реализованы WMS-202
и отражены в generated OpenAPI. Матрица ролей/складов принята ADR-0019.
Сроки сессии оператор задаёт явно: каждый30..86400 секунд, idle<=absolute; числовых defaults нет.
Actor берётся только из проверенной сессии, доступ проверяется и до
replay сохранённого HTTP result. Отзыв сессии не отменяет уже committed складской факт.

WMS-202 implementation contract: login/me/logout и admin users/update/warehouse roles/
revoke-all/revoke-one подключены; DTO output содержит только UserProfileDto/CSRF/grants.
[Точные пути/коды](../../apps/backend/src/modules/identity/README.md#http-api-и-безопасные-результаты),
[владелец исполнения](../flows/identity.md), source Swagger в controllers и DTO.
Без session — 401; роль/CSRF — 403; duplicate/last admin — 409; login limit — 429.
Новая cookie не кэшируется в http_idempotency; старый Idempotency-Key receiving не обходит
актуальные ACL. Новых событий auth в registry нет: identity admin audit не warehouse outbox fact.
ReceivingPosted v1/quantity/limits не изменены.

## WMS-203: выполнение задания

Реализованы GET /api/v1/putaway-tasks/:taskId (read) и POST /:taskId/execute (putaway).
Execute body — только targetLocationId UUID; полное quantity из задания. Session/CSRF/Origin
и Idempotency-Key обязательны. 200 completed snapshot, 404 task, 409 already-completed/
insufficient-stock/idempotency-conflict, 422 invalid-zone/foreign-location/overflow;
401/403 и безопасные 400/500/503 — общие. Source — production DTO/controller, generated OpenAPI.

[PutawayCompleted v1](events/inventory.putaway-completed.v1.schema.json) и
[пример](examples/inventory.putaway-completed.v1.json) — новый совместимый тип, ReceivingPosted v1
не меняется. Registry/KnownEvent/generated bundle содержат оба типа. Общие UUID/UTC Z/int4/256KiB/
optional extensions rules сохраняются. Aggregate putaway-task, aggregateId=taskId,
causationId исходного receipt event; subscribers пока нет, retained outbox факт без delivery.
В будущем добавление consumer требует явного replay/start-position плана.
[Подробный flow](../flows/putaway-execution.md).

## WMS-204

Order API и события реализованы по ADR-0022: [flow](../flows/reservations.md),
[модуль](../../apps/backend/src/modules/fulfillment/README.md),
[source event schema](events/fulfillment.order-changed.v1.schema.json),
[пример](examples/fulfillment.order-changed.v1.json). Лимиты заказа утверждены 1..1000 SKU,
quantity int4, один warehouse. Reserve/release/cancel используют прежний idempotency protocol.
OrderDto/OrderLineDto/AllocationDto — явные публичные output; OpenAPI generated, SQL types не экспортируются.

### PickingProgressed v1 — WMS-205

Registry знает также fulfillment.picking-progressed v1, aggregate picking-task.
Source schema — events/fulfillment.picking-progressed.v1.schema.json, проверенный fixture —
examples/fulfillment.picking-progressed.v1.json. payload содержит taskId/orderId/action;
OrderChanged v1 не расширялся. Подписчиков нового агрегата нет. Producer и handler проверяют
schema/UUID/UTC/версию и общий лимит 262144 UTF-8 bytes. Optional extensions сохраняются.
Реальные DTO, маршруты и ошибки — [флоу сборки](../flows/picking.md), generated OpenAPI.

### ShippingChanged v1 — WMS-206

fulfillment.shipping-changed v1 зарегистрирован в прежнем order stream. Payload:
orderId/action и shipmentId для shipment-команд. Source schema/fixture — events и examples
с тем же именем. Предел 262144 UTF-8 bytes и общий envelope protocol сохраняются.
OrderChanged/PickingProgressed v1 не расширены несовместимыми enum. Нового consumer нет.
API v1 заказов получает completed/cancel_pending/closed_mixed и consumed/locationId/state
allocations; новые shipment/return DTO опубликованы в generated OpenAPI. Работающие
маршруты, права, количества и ограничения — [флоу shipping](../flows/shipping.md).

ShippingChanged review: payload.shipmentId обязателен для shipment-prepared,
shipment-posted, shipment-cancelled. Для cancellation-requested/completed он остаётся
необязательным. JSON Schema if/then проверяется на producer и handler; strictRequired,
UUID formats, отсутствие coercion и сохранение optional extensions не изменились.

## Реализованное чтение WMS-207

`GET /api/v1/warehouses/:warehouseId/{balances|movements|receipts|orders|putaway-tasks|picking-tasks|shipments|audit}`
возвращает `{items,nextCursor}` с явными JSON DTO, без ORM объектов. Это восемь отдельных
маршрутов, а не произвольный параметр имени таблицы. Limit 1..100, default 20.
Списки требуют read, audit требует audit; system_admin не получает обхода складских прав.
Cursor привязан к фильтрам, timestamp сохраняет microseconds; страницы читают текущие
statement snapshots. Summary не заменяет существующий detail response со строками.
[Фильтры, пример и согласованность](../flows/warehouse-reads.md); generated [OpenAPI](openapi.json).
Audit view исключает глобальные identity/catalog/recovery записи и JSON changes.
