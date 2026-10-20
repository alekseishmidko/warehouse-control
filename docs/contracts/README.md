# Система контрактов

## Источники истины

| Контракт | Источник | Потребитель |
|---|---|---|
| HTTP API | NestJS DTO + runtime validation + OpenAPI decorators | Web и интеграции |
| Документ OpenAPI | Генерируется из приложения, проверяется в CI | Генератор api-client |
| События | Версионированные JSON Schema в этой директории | Workers и Kafka consumers |
| Типы событий | Генерируются из JSON Schema | Backend и consumers |
| Данные БД | SQL/Drizzle migrations | Только backend |

TypeScript-типы сами по себе не валидируют вход. События проверяются по JSON
Schema перед записью outbox и на границе consumer. WMS-105 реализует общий
EventContracts с prepareForOutbox/parseForHandler, registry, runtime validator
и генерацию event types. Сам outbox/consumer и OpenAPI generation ещё предстоят.
Дублировать вручную одинаковые DTO в frontend запрещено.

## HTTP API

Будущий бизнес-префикс `/api/v1`; существующие `/` и `/health` пока остаются
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
Уникальность: `(actorId, operation, key)`; сохраняем hash нормализованного запроса
и результат успешной операции в её транзакции. Тот же ключ и другой запрос → 409.
Параллельный повтор сериализуется уникальным ограничением; успешный повтор
возвращает прежний результат. Политика хранения определяется перед реализацией;
первоначально записи не удаляем. Идемпотентность HTTP и consumer — разные механизмы.

Запись защищается проверкой ролей и доступа к складу на backend.
`actorId` берётся из доверенного auth context, а не из пользовательского body.
Входящие correlation IDs проверяем по формату и длине либо создаём новые.

## События

Имя: `<context>.<fact>` в прошедшем времени, пример `receiving.receipt-posted`.
Внутренние события не являются инструкциями consumer изменить исходный остаток.
Команды именуются отдельно и не маскируются под факты.

Обязательный конверт:

| Поле | Правило |
|---|---|
| eventId | UUID, неизменен при всех повторах и переходе на Kafka |
| type / schemaVersion | Тип факта и целая major-версия схемы |
| aggregateType / aggregateId | Агрегат, определяющий порядок |
| aggregateVersion | Последовательность опубликованных событий этого агрегата, от 1 |
| occurredAt | Время бизнес-факта UTC |
| correlationId | Идентификатор сквозного сценария |
| causationId | UUID породившего события; отсутствует для корневой HTTP-команды |
| traceparent | Необязательный W3C trace context, проверяется инструментарием OTel |
| payload | Данные по схеме типа и версии |

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
generated schema. Будущий receiving HTTP DTO обязан использовать эти же limits;
сейчас публичного DTO приёмки нет. Existing ReceiveStockDto принимает одну строку
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
Действующих INSERT outbox/handler ещё нет: эти границы обязательны для WMS-106/109.

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

Локальные проверки схем/fixtures/generation уже есть; CI workflow, OpenAPI gate,
сравнение breaking changes с основной веткой и consumer business integration ещё нет.

## Уточнение quantity WMS-104

Неопубликованная receiving.receipt-posted v1 schema теперь задаёт quantity
как integer 1..2147483647, согласованно с SQL int4 и service/audit validation.
Старый MAX_SAFE_INTEGER снят только с quantity, не aggregateVersion.
События/consumer contracts ещё не публиковались; после публикации аналогичное
сужение станет breaking change и потребует новой major-версии.
Unit stock-quantity.spec.ts сверяет общий int4 contract, а event-contracts.spec.ts
теперь проверяет этот диапазон полноценным runtime validator WMS-105 на обеих границах.
