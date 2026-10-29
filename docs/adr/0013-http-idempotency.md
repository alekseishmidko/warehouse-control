# 0013. HTTP boundaries и атомарная идемпотентность команд

- Дата: 2026-10-23
- Статус: Частично заменён ADR-0020 (временная identity); HTTP/idempotency гарантии сохранены.
- Уточняет реализацию ADR-0004, использует гарантии ADR-0008/0012, не заменяет их.

## Контекст

Перед приёмкой нужен общий HTTP-контракт с runtime DTO validation и результатом,
который можно безопасно вернуть после потерянного ответа. Нет production identity;
открывать незащищённые бизнес-команды или доверять actor из body нельзя.

## Решение

Бизнес-prefix `/api/v1`, технические GET `/` и `/health` исключены. Общие
ValidationPipe/ProblemFilter/DevActorGuard — infrastructure/http, без обязательного
слоя ports для каждого класса. DTO проверяются class-validator/class-transformer,
implicit conversion отключён, неизвестные поля отклоняются. Ошибки имеют статические
code/detail и application/problem+json, без raw errors/SQL/credentials. CorrelationId
из UUID header либо генерируется; invalid header даёт 400 и новый безопасный UUID ответа.

Dev actor выключен по умолчанию. Включение требует explicit NODE_ENV development/test,
DEV_ACTOR_ENABLED=true, server DEV_ACTOR_ID UUID и loopback HTTP_HOST. Guard проверяет
loopback peer и отсутствие proxy headers; production/public bind запрещены при включении.
Это временный локальный режим до identity, не authentication для внешнего стенда.
Бизнес-routes закрыты guard по умолчанию, исключение имеют только технические handlers.

HttpCommandsService владеет единственной transaction. Scope уникален по
`(actorType,actorId,operation,key)`, Idempotency-Key — UUID, operation задаётся
декоратором server code. Fingerprint — SHA-256 canonical JSON нормализованных target/body.
CorrelationId/небизнесовые headers исключены. Семантическая нормализация у владельца
DTO; shared serializer задаёт только порядок keys и допустимость plain JSON.

INSERT ON CONFLICT DO NOTHING на scope ждёт другую транзакцию. После её commit
отдельный SELECT read committed видит result: совпал hash → прежний status/body/Location,
различается → 409. После rollback предыдущего владельца waiter может вставить свою строку.
Claim, бизнес-изменения, audit/outbox и response complete UPDATE коммитятся вместе.
Ошибки не кешируются. Callback выполняет только awaited DB-эффекты с общим context;
повтор не обязан вызывать callback. Авторизация выполняется перед dedup на каждом запросе.

Сохраняются 200/201/202 JSON body и allowlisted relative Location, без cookie/auth
headers. CorrelationId текущего HTTP ответа не сохраняется. Ответ отправляется после
commit; client disconnect не отменяет DB-команду. Новый ключ после timeout может
создать повторный бизнес-факт, поэтому требуется исходный ключ. Automatic retry нет.
Completed result/identity immutable, DELETE/TRUNCATE запрещены до retention policy.

OpenAPI генерируется из production graph без DB lifecycle/init: config override в
offline CLI. В artifact только два существующих technical GET, Problem/header schemas.
Test controller не входит production graph. Generation diff локально проверяет
test:prepare, CI compatibility comparison и Swagger UI ещё не включены.

## Альтернативы

In-memory/Redis result не атомарен с бизнес-PostgreSQL. Отдельный commit ключа оставляет
зависший pending или повтор эффекта при crash. Cache только HTTP response после commit
оставляет окно потери result. Advisory locks здесь не нужны: unique scope служит
одновременно сериализацией и долговечным результатом. Hash сырого JSON дал бы ложные
конфликты на порядок полей/допустимую нормализацию. Dev actor из headers подделывается.

## Последствия и проверка

Повтор зависит от доступности PostgreSQL, один scope ждёт длинную первую transaction,
history растёт без TTL. Committed pending row — нарушение протокола, не повод незаметно
выполнить callback ещё раз. DBA и direct SQL способны обойти защиту. JSON depth<=64,
HTTP/request/result<=256 КиБ, ключ — UUID; расширения требуют проверки contracts.
Старые plain service errors пока становятся безопасным 500, бизнес mapper расширяется
явно при новых сценариях. Exactly once для внешнего I/O не обещается.

Реальные HTTP/PostgreSQL tests проверяют normalized replay, другой payload, concurrent
winner/conflict, rollback и waiter takeover, сетевой deadline клиента, scope/target,
runtime grants и запреты dev режима. Источники: [Nest validation](https://docs.nestjs.com/techniques/validation),
[Nest OpenAPI](https://docs.nestjs.com/openapi/introduction),
[PostgreSQL INSERT](https://www.postgresql.org/docs/17/sql-insert.html).
[HTTP README](../../apps/backend/src/infrastructure/http/README.md),
[storage README](../../apps/backend/src/infrastructure/idempotency/README.md).

## Направление замены временной identity — ADR-0018

2026-10-29 приняты логин/пароль с серверными сессиями и threat assumptions
[ADR-0018](0018-server-sessions.md). Замена dev actor выполнена WMS-202 по ADR-0020: AuthGuard/session/warehouse policy
работают без fallback; прежний DevActorGuard удалён. HTTP validation, transaction scope, dedup и проверка доступа
перед replay сохраняются; dev actor не должен стать fallback для обхода новой auth.
