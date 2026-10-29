# Система контрактов

## Источники истины

| Контракт         | Источник                                                       | Потребитель                  |
| ---------------- | -------------------------------------------------------------- | ---------------------------- |
| HTTP API         | NestJS DTO + runtime validation + OpenAPI decorators           | Web и интеграции             |
| Документ OpenAPI | Генерируется из приложения, локальный diff check; CI предстоит | Будущий генератор api-client |
| События          | Версионированные JSON Schema в этой директории                 | Workers и Kafka consumers    |
| Типы событий     | Генерируются из JSON Schema                                    | Backend и consumers          |
| Данные БД        | SQL/Drizzle migrations                                         | Только backend               |

TypeScript-типы сами по себе не валидируют вход. События проверяются по JSON
Schema перед записью outbox и на границе consumer. WMS-105 реализует общий
EventContracts с prepareForOutbox/parseForHandler, registry, runtime validator
и генерацию event types. Writer подключён WMS-106, OpenAPI generation WMS-107; consumer inventory.putaway реализован WMS-110.
Дублировать вручную одинаковые DTO в frontend запрещено.

## HTTP API

Настроен бизнес-префикс `/api/v1`; существующие `/` и `/health` остаются
каркасными маршрутами. Не документировать будущие endpoint как работающие.
JSON использует camelCase, идентификаторы — UUID, время — UTC RFC 3339.
Списки: cursor pagination с фиксированным стабильным порядком и максимальным limit.

Ошибки: `application/problem+json`, поля `type`, `title`, `status`, `detail`,
`instance`, расширения `code`, `correlationId`, при необходимости `errors`.
Стабильный `code` предназначен для клиента; stack trace наружу не выдаётся.
Коды: 400 — некорректный ввод; 401/403 — доступ; 404 — отсутствие;
409 — конфликт состояния, версии или ключа идемпотентности;
422 — нарушение бизнес-правила, например недостаточный остаток.

Для команд с побочными эффектами обязателен `Idempotency-Key`.
Уникальность: `(actorType, actorId, operation, key)`; сохраняем hash нормализованного запроса
и результат успешной операции в её транзакции. Тот же ключ и другой запрос → 409.
Параллельный повтор сериализуется уникальным ограничением; успешный повтор
возвращает прежний результат. Политика хранения определяется перед реализацией;
первоначально записи не удаляем. Идемпотентность HTTP и consumer — разные механизмы.

Целевая production запись защищается проверкой ролей и доступа к складу на backend.
С WMS-202 business routes требуют server session, CSRF для unsafe и warehouse permission.
`actorId` берётся из доверенного auth context, а не из пользовательского body.
Входящие correlation IDs проверяем по формату и длине либо создаём новые.

## События

Имя: `<context>.<fact>` в прошедшем времени, пример `receiving.receipt-posted`.
Внутренние события не являются инструкциями consumer изменить исходный остаток.
Команды именуются отдельно и не маскируются под факты.

Обязательный конверт:

| Поле                        | Правило                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| eventId                     | UUID, неизменен при всех повторах и переходе на Kafka              |
| type / schemaVersion        | Тип факта и целая major-версия схемы                               |
| aggregateType / aggregateId | Агрегат, определяющий порядок                                      |
| aggregateVersion            | Последовательность опубликованных событий этого агрегата, от 1     |
| occurredAt                  | Время бизнес-факта UTC                                             |
| correlationId               | Идентификатор сквозного сценария                                   |
| causationId                 | UUID породившего события; отсутствует для корневой HTTP-команды    |
| traceparent                 | Необязательный W3C trace context, проверяется инструментарием OTel |
| payload                     | Данные по схеме типа и версии                                      |

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

## Будущие CI gates

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
События/consumer contracts ещё не публиковались; после публикации аналогичное
сужение станет breaking change и потребует новой major-версии.
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

DEV_ACTOR_ENABLED по умолчанию false. Включение требует explicit NODE_ENV dev/test,
loopback HTTP_HOST и server-side DEV_ACTOR_ID UUID; guard проверяет peer/proxy headers.
Session auth/ACL реализованы WMS-202, anonymous business routes закрыты. Технические GET public.

[openapi.json](openapi.json) — generated из production controllers, не править вручную.
Команды `pnpm openapi:generate` / `pnpm openapi:check` выполняют build, затем offline CLI
без .env/DB init/listener; test:prepare включает diff check после build. В paths только
реальные технические routes и три receiving операции; примеры — [receiving](../receiving.md).
Swagger UI и frontend api-client пока не добавлены. Подробности/ограничения:
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
используются из существующей schema. Task DTO внутренний, новых HTTP routes/OpenAPI schemas нет.
Известные неинтересные type в будущем проходят no-op handler и cursor. Сейчас registry знает
только ReceivingPosted: surrogate unit test не добавляет реального контракта. Unknown type/version
по-прежнему permanent dead до handler. [Схемы и диагностика](../flows/putaway.md).

## WMS-201: границы будущих контрактов fulfillment

[Проект команд и лимитов](fulfillment.md) отделяет действующие receiving contracts
от будущих order/reservation/picking/shipment. Бизнес-выбор B1–B4 утверждён 2026-10-29;
новые routes, события и схемы не зарегистрированы и не включаются в generated OpenAPI.
Количество int4, предел ReceivingPosted 262144 bytes и receiving 1..1000 строк сохранены.
Предложение тех же лимитов новым документам не означает их утверждения или реализации.
Breaking change требует новой версии/миграции; текущие source schemas/generated artifacts
этой задачей не изменяются. Числовые примеры — [будущие AC](../flows/fulfillment.md), не fixtures готового API.

## Направление auth WMS-202

Приняты логин/пароль и серверная сессия, а также threat assumptions, см.
[ADR-0018](../adr/0018-server-sessions.md) и [identity](../identity.md). Auth endpoints, DTO, cookie/CSRF policy и permissions реализованы WMS-202
и отражены в generated OpenAPI. Матрица ролей/складов принята ADR-0019; только сроки сессий
ожидают отдельного ответа владельца продукта.
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
