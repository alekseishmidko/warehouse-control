# Операционное логирование и трассировка WMS-401

## Назначение, вход и доверие

Оператор ищет документ по `aggregateId`, запрос по `correlationId`, доставку по
`eventId`. Логи не дают складских прав и не заменяют транзакционный AuditService.
Session/CSRF/warehouse ACL, идемпотентность, lease fencing и at least once не меняются.
Вход HTTP, event extensions, framework/driver errors считаются недоверенными.
В лог не передаются body, query, URL, headers, cookies, tokens, SQL, payload, actor,
логин или текст исключения. UUID документа — технический идентификатор, не пользователь.

[ADR-0030](../adr/0030-operational-observability.md) определяет модель spans и каналов.
[Матрица AC и результаты проверок](../reports/wms-401.md).

## Владельцы и последовательность

`shared/logging` хранит каталог событий/уровней/сообщений и allowlist scalar полей.
`infrastructure/logging` владеет одним Pino sink процесса, AsyncLocalStorage,
Nest adapter, buffering и OTel. Модули не создают экземпляры logger/SDK.
Все executable импортируют `startup` до Nest и application imports. Импорт библиотек
в тест/генератор не загружает рабочую `.env` и не запускает глобальный SDK.

```mermaid
sequenceDiagram
  participant S as Startup
  participant H as HTTP middleware
  participant C as HttpCommandsService
  participant T as TransactionRunner
  participant D as PostgreSQL
  participant L as Pino stderr
  participant W as WorkerService
  S->>S: env → Pino → OTel → Nest
  H->>H: UUID correlation; validated W3C remote parent
  H->>C: request-local context; operation span
  C->>T: transaction span; один callback
  T->>D: business + Audit + outbox + saved result
  Note over T,L: receiving.posted буферизуется; внешнего I/O в callback нет
  D-->>T: COMMIT завершён
  T->>L: buffered facts; transaction.committed
  C->>L: operation.completed либо operation.replayed
  W->>D: claim COMMIT
  W->>W: root CONSUMER span; link на producer из envelope
  W->>D: handler + marker + cursors + ack, один COMMIT
  W->>L: delivery.completed либо retry/dead/stale
```

1. Startup загружает optional root env; существующие process env имеют приоритет.
   Pino получает service `warehouse-backend`, environment и роль `api/worker/cli`.
   У раннего fallback environment=`unknown`; остальные обязательные поля сохраняются.
2. HTTP middleware принимает только UUID `X-Correlation-Id`, нормализует регистр или
   генерирует новый ID. Неверный заданный ID возвращает прежний400; его значение не отражается.
   Middleware создаёт SERVER span и пишет один итог после finish/close. Abort — отдельное событие.
3. `traceparent` принимается только W3C v00: lowercase32/16 hex, ненулевые IDs и flags.
   Неверный header игнорируется; он не даёт auth и не становится причиной раскрытия входа.
   Baggage/tracestate не распространяются. ALS изолирует параллельные запросы/доставки.
4. HttpCommandsService создаёт operation span, пишет начало и результат после runner.
   Для receiving итог содержит безопасные ID документа/события, включая replay с новым
   correlationId. Сам replay не создаёт второй receiving.posted или outbox effect.
5. Outbox writer добавляет активный producer traceparent, который имеет приоритет над
   extension caller. Без активного span сохраняется только валидный explicit traceparent.
   После JSON snapshot выполняется повторная проверка; baggage/tracestate удаляются.
   SchemaVersion и generated event contracts не меняются; старые события без tracing допустимы.
6. Worker начинает отдельный root trace каждой попытки. CONSUMER span связывается link
   с producer после валидации envelope. Transaction span — дочерний к handler; link находится
   именно на handler. Логи содержат eventId/aggregateId/destination/attempt/correlationId.
   Retry сохраняет eventId и получает новый handler trace, а не продолжает старый HTTP trace.
7. Handler completed/retry/dead логируется после соответствующего commit; stale не означает
   применение эффекта. Ошибка сохранения failure имеет отдельное persistence_failed событие.

## Commit, rollback и неопределённый результат

Runner не добавляет retry. Внутри callback logger складывает только безопасные записи в ALS
буфер; SQL callback не вызывает внешний sink. `receiving.posted` выводится только после
завершения `db.transaction`, включая deferred constraints. Ошибка уничтожает буфер.
Callback exception с успешно подтверждённым ROLLBACK даёт `transaction.rolled_back`.
Ошибка COMMIT/соединения или потеря подтверждения ROLLBACK даёт `transaction.failed`:
исход не подтверждён, нельзя обещать отсутствие commit. Caller повторяет исходный key
по действующему протоколу. Operational logs не становятся источником складской истины.
Span ошибки имеет ERROR без recordException/raw stack; retry/dead handler имеют ERROR,
stale — UNSET. Синхронная ошибка sink и асинхронный stream error не запускают бизнес-повтор.
Pool error listener привязан AsyncResource к startup owner: поздняя socket error не
наследует correlation/trace первого запроса и не попадает в его завершённый log buffer.
Логирование best effort: закрытый stderr может потерять записи. Гарантии доставки логов нет.

## Поля, уровни и privacy

Каждая operational строка — JSON с timestamp ISO8601, level string, service, environment,
process, module, event, message. Сообщение выбирается из каталога и не склеивается с ID.
Дополнительно: correlationId, traceId/spanId, eventId, aggregateId, destination, attempt,
durationMs, httpStatus, errorCode. Некорректные поля опускаются. Error codes ограничены
каталогом; recovery CLI сохраняет `code` как alias проверенного errorCode. Для error без
кода используется OPERATION_FAILED. Модули, identity и числовые диапазоны валидируются.

Info — lifecycle и подтверждённый результат. Warn — отказ запроса, rollback, retry/stale.
Error — failed/dead/потеря persistence/неизвестный outcome. Debug/verbose Nest отключены.
Nest получает общий adapter; произвольные messages/stack/optionalParams заменяются
статическими framework.* событиями. Это осознанно уменьшает детализацию ради privacy.
Allowlist применяется до serialization/buffering; redaction Pino — дополнительная защита.

## Настройки, exporter и завершение

По умолчанию `LOG_FORMAT=json`; operational output идёт в **stderr**. CLI stdout —
отдельный существующий протокол результата: inspect (включая явно запрошенный payload),
bootstrap и другие результаты. Он не относится к collection логов. Collector CLI должен
читать stderr, иначе результат команды можно ошибочно собрать как operational log.
Вывод pnpm/Nest compiler/Docker Compose — внешний wrapper, не JSON приложение.

`LOG_FORMAT=pretty` разрешён только при NODE_ENV=development, interactive stderr TTY
и LOG_COLLECTOR_ENABLED!=true. Для collector задавать `LOG_COLLECTOR_ENABLED=true` и json;
не включать pretty в контейнере. Неизвестный LOG_FORMAT или запрещённый pretty останавливают
startup безопасным JSON fallback без raw error. Рабочая `.env` для реализации не меняется.

`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces` включает OTLP/HTTP
export. Endpoint должен быть http(s), без userinfo/query/hash. Credentials в URL запрещены.
Без endpoint spans и IDs работают локально; сеть не используется, spans не сохраняются.
Collector не устанавливается WMS-401: Loki/Grafana/Prometheus/Tempo относятся к WMS-402.
Export error даёт только telemetry.failed; SDK DEBUG/diagnostic console обход закрыт.

SDK получает service/environment/process/runtime attributes и случайный instance UUID.
Resource autodetection, auto HTTP/pg instrumentation, log/metric exporters отключены:
никаких process argv/hostname/env, URL, SQL и полного exception. Tracing ручной.
SIGTERM сначала завершает действующий lifecycle drain API/worker. После закрытия ресурсов
beforeExit flush-ит SDK, затем пишет process.stopped и закрывает pretty transport.
OTLP request timeout1s, batch export timeout1.5s, pretty close2s; общий telemetry/log shutdown
имеет hard deadline3s и exit1 при превышении. Это дополнение к API/worker drain budget,
при текущих dev values укладывается в Kubernetes grace30s. При увеличении worker shutdown
timeout нужно увеличить grace с учётом дополнительных3s. Аварийный process.exit/SIGKILL не гарантирует flush.

## Диагностика и проверки

[Logging README](../../apps/backend/src/infrastructure/logging/README.md) содержит команды
и пример. Unit suites `logging.spec.ts`, `telemetry.spec.ts`, `environment.spec.ts`
проверяют JSON/allowlist, ALS, safe fallback, real pretty transport и настоящий OTLP HTTP
export в локальный test collector. `observability.spec.ts` использует реальные HTTP,
PostgreSQL migrations, outbox и worker: документ, replay, parallel contexts, retry,
deferred COMMIT error и потерю ACK ROLLBACK. `outbox.spec.ts` проверяет совместимость
событий без активного SDK. Эти проверки не доказывают установку внешнего collector/SLO.
