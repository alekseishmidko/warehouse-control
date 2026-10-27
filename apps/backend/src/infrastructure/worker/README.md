# PostgreSQL outbox worker — WMS-109

## Для менеджера

Реализован протокол надёжной обработки: отдельный процесс забирает доставку,
вызывает локальный обработчик и сохраняет результат. Сбой не оставляет частичный
результат; повтор доставки не повторяет уже сохранённый эффект. Ошибка может задержать
следующие события одного документа, но другие документы продолжают обрабатываться.

WMS-110 подключает настоящий ReceivingPostedHandler: inventory.putaway создаёт одну
pending PutawayTask на строку проведённой приёмки. Task/audit/marker/cursors/completion
фиксируются вместе; stock/movement приёмки не повторяются. Delivery completed означает,
что task создана, а task pending — что физическое размещение ещё ожидается.
[Подробный бизнес-флоу и SQL диагностика](../../../../../docs/flows/putaway.md).

At least once, порядок только внутри `(destination, aggregateType, aggregateId)`.
Нет обещания exactly once или глобального порядка, Kafka и внешние эффекты отсутствуют.
Dead останавливает поток до управляемого восстановления WMS-111, которое ещё не реализовано.
Сохранённые receiving/stock данные от этого не откатываются.

## Для разработчика

WorkerModule — отдельный Nest graph, не импортирует AppModule/HTTP controllers.
Экспортирует WorkerService и WorkerLoop; WorkerRepository внутренний. Transport handler
контракт локален capability: принимает opaque TransactionContext и validated KnownEvent,
не требует обязательного domain/application слоя. Общие transaction/event contracts
переиспользуются; бизнес-операции вызываются через сервисы владельцев.

| Файл | Ответственность |
|---|---|
| ../../worker.ts | Executable bootstrap без HTTP, validated config |
| worker.module.ts | DatabaseModule/InventoryModule и явная регистрация ReceivingPostedHandler |
| worker.config.ts | Worker-only env validation/defaults, DI token |
| worker.schema.ts | Source processed_events/consumer_streams для Drizzle |
| dto/delivery.dto.ts | Frozen scalar claim и LocalEventHandler contract |
| delivery-policy.ts | Permanent/stale errors, safe classification, equal jitter |
| services/receiving-posted.handler.ts | Production inventory.putaway, server actor и вызов публичного inventory API |
| services/handler-registry.ts | Регистрация стабильных destinations, duplicate guard |
| services/worker.service.ts | Владелец claim/process/failure transactions |
| repositories/worker.repository.ts | SKIP LOCKED, token locks, markers/cursors/ack SQL |
| services/worker-loop.ts | Последовательные polls, bounded batch parallelism, stop/drain |
| worker-process.ts | SIGTERM/SIGINT, hard deadline и pool/context cleanup |
| README.md | Этот контракт; [общий каталог](../../../../../docs/file-catalog.md) |

### Данные, миграции и права

Outbox events immutable; scheduling таблицы WMS-106 сохраняются. Новая generated
0011_spooky_epoch.sql добавляет:

- `processed_events`: PK `(consumer_name,event_id)`, FK outbox event, processed_at.
- `consumer_streams`: PK consumer/aggregateType/id, FK aggregate counter,
  last_processed_version 0..MAX_SAFE_INTEGER.

Logical consumerName равен stable destination (`inventory.putaway`), сохраняется при
будущем переносе транспорта. Delivery cursor и consumer cursor различны: первый
координирует транспорт, второй доказывает применение полного потока обработчиком.
Новый consumer/destination требует migration и replay/start-position плана.

Custom 0012_worker-retention.sql: runtime processed_events SELECT/INSERT,
consumer_streams SELECT/INSERT/UPDATE, immutable markers, retained cursor и запрет
изменения identity/движения consumer cursor назад. DELETE/TRUNCATE запрещены до replay
policy; DBA может обойти triggers. SQL constraints не доказывают наличие бизнес-эффекта:
это контракт awaited handler и общей транзакции. Обычный Compose остаётся dev admin.

### Взаимодействие и движение данных

[Подробный флоу с графическими схемами](../../../../../docs/flows/worker.md):
polling/claim, три транзакционные границы, успешная обработка и дубликат, состояния
БД до/после commit, retry/dead, два workers/lease/token, crash recovery и SIGTERM.
Ниже — краткий обзор; подробные ветки имеют одного владельца в этом разборе.

```mermaid
sequenceDiagram
  participant P as worker.ts / WorkerLoop
  participant S as WorkerService
  participant R as WorkerRepository
  participant DB as PostgreSQL
  participant H as Registered DB handler
  P->>S: claim()
  S->>DB: BEGIN, transaction timeout
  S->>R: registered destinations, config
  R->>DB: next version JOIN, FOR UPDATE OF stream/delivery SKIP LOCKED
  R->>DB: processing, attempts+1, shared lease/token
  S->>DB: COMMIT claim
  S-->>P: frozen claims
  par До batchSize разных потоков
    P->>S: process(claim)
    S->>DB: BEGIN, lock stream/delivery
    S->>S: token/lease/cursor + parseForHandler
    S->>R: lock consumer cursor, check marker
    alt Marker отсутствует
      S->>H: handle(context, validated event)
      H->>DB: awaited effect через сервисы владельцев
      S->>R: INSERT processed marker
    else Marker уже существует
      Note over S,H: Эффект не повторяется
    end
    S->>R: consumer cursor + delivery completion + stream cursor
    S->>DB: COMMIT всех эффектов
  end
  Note over S,DB: Ошибка → ROLLBACK; отдельный token-checked run → retry/dead
```

1. Entry point валидирует общую DB config и worker settings, создаёт application
   context без HTTP. API не запускает polling. Handler registrations — server code,
   event payload не выбирает произвольный handler/consumer.
2. Один короткий run claim выбирает максимум batchSize потоков только для реально
   зарегистрированных destinations. Event version = last_completed_version+1.
   Pending/retry должны иметь available_at <= DB clock, processing — истёкший lease;
   lease stream также свободен/истёк. Dead/completed predecessor не пропускается.
3. `FOR UPDATE OF s,d SKIP LOCKED` захватывает stream/delivery. Каждому выдаётся
   random UUID token, одинаковый DB deadline, status processing и attempts+1. При
   attempts >= max после crash delivery становится dead/ATTEMPTS_EXHAUSTED без новой
   попытки эффекта. Claim возвращается только после commit.
4. Новый run обработки ограничен PostgreSQL transaction_timeout/statement_timeout.
   Повторно блокирует stream/delivery и проверяет оба token, live lease, status и cursor
   после получения locks. Stale/expired/completed — результат stale без эффектов.
   Даже пока handler работает после истечения lease, reclaim пропускает реальные locks.
5. EventContracts.parseForHandler проверяет сохранённый envelope до допуска handler;
   routing identity дополнительно сверяется с claim. Неизвестная версия — dead без ack.
6. Создаётся/блокируется consumer cursor, читается marker. Без marker требуется строго
   previous = version-1. При marker требуется cursor >= version; эффект пропускается.
   Иные случаи — CURSOR_MISMATCH/dead, не молчаливый пропуск истории.
7. Handler выполняет только awaited DB operations в общем context. После него INSERT
   marker, продвижение consumer cursor, completed delivery, stream cursor и освобождение
   lease фиксируются вместе. Ошибка любого шага откатывает весь run, включая effect.
8. Отдельный короткий failure run заново проверяет token/status/live lease под locks.
   Только текущий владелец назначает retry/dead, освобождая stream lease без продвижения
   cursor. Если claim уже сменился/commit успел пройти — stale, чужой результат не меняется.
   DB outage при сохранении failure оставляет processing до автоматического lease recovery.

Handler не открывает nested run и не выполняет сетевое/файловое I/O, отправку почты,
fire-and-forget или публикацию Kafka. Новые outbox/audit эффекты при необходимости
используют тот же context. CPU-heavy и бесконечные handlers запрещены; event loop timer
не умеет прерывать синхронный JS. Heartbeat/продление lease и внешние delivery — будущая работа.

### Ошибки, retry и остановка

EventContractError и PermanentDeliveryError — permanent; SQLSTATE классов 22/23/42 —
DATABASE_REJECTED. Deadlock/serialization/disconnect/timeout и неизвестный отказ —
TRANSIENT_FAILURE до maxAttempts. Raw exception.message/stack/payload не сохраняются.
last_error — только allowlisted code; это durable dead parking, отдельной quarantine table
и inspect/retry CLI пока нет. Permanent handler может использовать HANDLER_REJECTED.

Equal jitter: cap=min(retryMaxMs,retryBaseMs*2^(attempt-1)), delay в [cap/2,cap], минимум
1ms; available_at рассчитывается PostgreSQL clock. Это retry всей доставки после rollback,
не retry отдельных SQL/HTTP транзакций runner. Dead блокирует только свой поток.

SIGTERM/SIGINT синхронно запрещает новый claim и прерывает poll timer. Если signal
пришёл во время claim, полученные, но не начатые claims остаются до lease expiry.
Активный batch ожидается до единого shutdown deadline, затем закрывается Nest/pg pool.
При deadline exit=1, ОС закрывает sockets, открытый DB run откатывается. Нормальный exit=0.
PostgreSQL 17 transaction_timeout ограничивает DB transaction, включая idle JS ожидание;
hard deadline также покрывает зависший handler promise/startup/pool.close. SIGKILL требует
lease recovery, graceful shutdown не гарантируется. Миграции при startup не выполняются.

### Конфигурация и запуск

`pnpm db:migrate`, `pnpm build`, затем отдельный `pnpm worker`. Production registry содержит inventory.putaway. API — другой процесс
`pnpm dev`/`pnpm start`; worker HTTP-порт не слушает, runtime credentials не выводит.
DATABASE_URL чувствителен; root .env optional, env процесса приоритетен. Новые worker-only
settings проверяются отдельно и не делают API зависимым от конфигурации worker.

| Env | Default | Диапазон / смысл |
|---|---|---|
| WORKER_BATCH_SIZE | 4 | 1..4; число параллельных streams, pool=5 оставляет резерв |
| WORKER_POLL_INTERVAL_MS | 1000 | 10..60000, пауза после batch/ошибки |
| WORKER_LEASE_MS | 30000 | 100..300000, больше transaction timeout |
| WORKER_RETRY_BASE_MS | 1000 | 1..60000 |
| WORKER_RETRY_MAX_MS | 60000 | 1..3600000, не меньше base |
| WORKER_MAX_ATTEMPTS | 10 | 1..1000, включая claim до crash |
| WORKER_TRANSACTION_TIMEOUT_MS | 10000 | 50..300000, PostgreSQL 17 whole transaction |
| WORKER_SHUTDOWN_TIMEOUT_MS | 15000 | 100..300000, больше transaction timeout |

Пример input claim: eventId UUID, destination inventory.putaway, aggregateType receipt,
aggregateId UUID, version=1, token новый UUID. При явно отключённом registry в tests claim возвращает []. При
зарегистрированном production handler: process(claim) → completed, effects=1, marker=1,
consumer cursor=delivery cursor=1; повтор process(oldClaim) → stale, effects остаются 1.
Если handler бросил transient error: effect/marker отсутствуют, delivery retry,
оба cursors 0; новое подтверждение только после повторной успешной обработки.

### Проверки и эксплуатация

[worker.spec.ts](../../../test/integration/worker.spec.ts): реальные PostgreSQL locks,
две Nest/pg worker graphs, ordering/independent aggregates, stale tokens, SQL AFTER
fault injection, lease recovery, retry/dead, marker redelivery, role/retention/cursor.
[worker-process.spec.ts](../../../test/integration/worker-process.spec.ts): actual child
processes, SIGTERM drain/deadline, SIGKILL и DB recovery, отсутствие новых claims.
[worker-policy.spec.ts](../../../test/unit/worker-policy.spec.ts): config/jitter/classification.
`pnpm test`, `pnpm typecheck`, `pnpm db:generate` (no diff после generation).
Тесты используют real migrations и disposable harness, Docker failure — не skip.

Fixed безопасные lifecycle/poll ошибки пока идут в stdout/stderr. Централизованные
key-value логи/метрики/tracing — WMS-401/402; HTTP readiness worker ещё нет.
Диагностика: eventId/destination/attempts/last_error/lease/token и оба cursors;
не сбрасывать lease/cursor/markers руками. [Runbook](../../../../../docs/runbooks/event-recovery.md),
[ADR-0015](../../../../../docs/adr/0015-postgres-worker.md), [outbox](../outbox/README.md).
