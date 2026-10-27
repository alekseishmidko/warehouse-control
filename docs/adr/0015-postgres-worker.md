# 0015. PostgreSQL worker: stream lease, fencing и атомарный DB handler

- Дата: 2026-10-25
- Статус: Accepted
- Реализует протокол ADR-0003/0012, сохраняет transaction guarantees ADR-0008.

## Контекст и решение

Нужны несколько worker процессов с at least once и порядком внутри агрегата.
SKIP LOCKED по отдельным events не сохраняет порядок. Создаём отдельный executable
Nest worker graph без HTTP и автоматического импорта API composition root.

Короткая claim transaction блокирует stream/delivery SKIP LOCKED только для версии
cursor+1. DB clock задаёт lease, UUID token одинаков на stream/delivery, attempts
учитывает даже claim перед crash. Новый processing run повторно блокирует обе строки
и проверяет token/lease/state/cursor, затем валидирует envelope до handler.
Активные row locks удерживаются до commit, поэтому истёкший lease не позволяет второму
DB handler обойти незавершённую обработку. Token не является fencing внешнего I/O/Kafka.

Processed_events unique(consumerName,eventId) и отдельный consumer_streams cursor
фиксируются вместе с DB effect, delivery completion и transport cursor. Stable consumer
name равен destination, сохраняется при будущем переносе транспорта. Marker позволяет
transport replay без повторного эффекта; gap без marker не считается успехом.
Markers retained/immutable, consumer identity/cursor retained/monotonic, DBA может обойти guards.

Ошибки откатывают обработку; отдельный token-checked run назначает bounded exponential
equal-jitter retry/dead. Contract/explicit permanent и SQL 22/23/42 — dead;
остальные отказы transient до budget. last_error только безопасный code. Dead блокирует
следующую версию; expired abandoned claim восстанавливается или становится dead по budget.
Это retry доставки целиком, runner по-прежнему не повторяет SQL/HTTP автоматически.

Batch=1..4, исходный pg pool=5. Whole-transaction PostgreSQL 17 timeout ограничивает
DB execution; SIGTERM запрещает новый claim, ожидает batch и закрывает pool в общем
deadline. Hard exit=1 при зависшем callback/close; CPU-blocking JS не прерывается timer.
Внешнее I/O в handler запрещено. Heartbeat и долгие операции пока не реализуются.

Registry заполняется явно. До WMS-110 production handlers нет: зарегистрированная
delivery inventory.putaway остаётся pending, не подтверждается fake no-op.
Protocol integration использует только технический DB handler в disposable БД.

## Альтернативы и последствия

- EventEmitter/fire-and-forget не дают durable recovery.
- Event row claim без stream cursor допускает обгон версии.
- Один handler до всех batch records последовательно тратит lease на ожидание;
  небольшой parallel batch сразу запускает независимые агрегаты.
- Только lease без processing locks допускает stale DB effect. Locks + token подходят
  локальному handler, но не обеспечивают DB+Kafka atomicity или отмену сетевой отправки.
- Только transport cursor не сохраняет logical consumer dedup при смене транспорта.
- ACK без реального handler теряет обязательный бизнес-эффект; пустой registry безопаснее.

Нет exactly once/глобального порядка, retention/admin retry/replay CLI, readiness endpoint,
Kubernetes и Kafka ещё предстоят. Обработчик размещения — WMS-110, управляемый retry — WMS-111.
Протокол проверяется real PostgreSQL races/faults и child process signals.
[Модуль/пошаговая схема](../../apps/backend/src/infrastructure/worker/README.md).

Источники: [PostgreSQL 17 SELECT / SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html),
[transaction_timeout](https://www.postgresql.org/docs/17/runtime-config-client.html).

Реализация регистрации handler уточнена WMS-110: [ADR-0016](0016-durable-putaway-handler.md).
Протокол locks/markers/cursors сохраняется, production registry теперь содержит реальный handler.
