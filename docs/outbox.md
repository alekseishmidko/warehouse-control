# Transactional outbox и доставка

## Гарантии

Данные операции, stock movements, audit и событие фиксируются одной транзакцией
PostgreSQL. Неуспешная операция не оставляет ни одного из этих эффектов.
Outbox — надёжная очередь фактов; бизнес-код не публикует напрямую в Kafka.
Доставка at least once, обработка идемпотентная, порядок только внутри агрегата.
Глобальный порядок и exactly once между PostgreSQL и Kafka не гарантируются.

## Логическая модель хранения

Это проект таблиц, не применённая миграция:

- `outbox_events`: event_id PK, aggregate_type/id/version, envelope JSONB,
  created_at. Unique `(aggregate_type, aggregate_id, aggregate_version)`.
  Содержимое события неизменяемо.
- `outbox_deliveries`: event_id, destination, status, attempts, available_at,
  lease_until, lease_token, last_error, completed_at.
  Unique `(event_id, destination)`. Статусы `pending`, `processing`, `retry`,
  `completed`, `dead`. Индекс по доступным незавершённым доставкам.
- `delivery_streams`: destination, aggregate_type/id, last_completed_version,
  lease_until/token. Unique по destination и агрегату. Координирует порядок.
- `processed_events`: consumer_name, event_id, processed_at;
  unique `(consumer_name, event_id)`.
- `consumer_streams`: consumer_name, aggregate_type/id, last_processed_version.
  Нужен обработчикам, которым важен последовательный полный поток.

Новая запись outbox и необходимые delivery rows создаются в бизнес-транзакции.
Первоначальный destination — стабильное имя локального обработчика.
Полный поток каждого агрегата получает каждый зарегистрированный consumer;
неинтересный тип — транзакционный no-op с продвижением cursor.
Новые consumers вводятся с явной стартовой позицией или replay, не с неявным
пропуском истории. Миграции регистрации destinations — часть выпуска.

## Claim и обработка первого этапа

1. Worker в короткой транзакции выбирает доступные stream rows через
   `FOR UPDATE SKIP LOCKED`. Claim только следующей версии потока;
   заблокированное/ошибочное событие не позволяет более поздним обогнать его.
2. Записывает lease и случайный token, увеличивает attempts, фиксирует claim.
3. Для локального DB handler в новой транзакции блокирует delivery и stream,
   проверяет token/lease и cursor. Вставляет processed_events через unique constraint.
4. Если событие уже обработано, не повторяет эффект. Иначе выполняет доменную
   операцию, записывает при необходимости новые outbox events и аудит.
5. Результат, processed marker, продвижение cursor и delivery completed
   фиксируются вместе. Во время этой транзакции delivery lock блокирует reclaim.
6. Ошибка откатывает весь эффект; отдельная короткая транзакция с проверкой token
   назначает retry или dead. Зависший lease допускает повторный claim.

Начальная политика retry: exponential backoff с jitter, база 1 секунда,
предел 60 секунд, максимум 10 попыток. Значения конфигурируемы и не являются SLO.
Долгие обработчики требуют продления lease или разбиения работы.
Worker не должен держать долгую транзакцию во время сетевого I/O.
Внешние эффекты оформляются отдельной delivery с idempotency key внешней системы.

`SKIP LOCKED` сам по себе не сохраняет порядок событий. Для этого нужны stream
cursor, claim только следующей версии и блокировка потока после ошибки.
Два разных агрегата допускают параллельную обработку.

## Сбои

| Точка сбоя | Результат |
|---|---|
| До commit бизнес-операции | Нет изменения и события |
| После commit до claim | Worker найдёт pending delivery |
| После claim до обработки | Повтор после lease expiry |
| Внутри локального handler | Rollback эффекта и processed marker |
| После локального commit | Повтор распознаётся по marker |
| Ошибка схемы/неподдерживаемая версия | Quarantine/dead и сигнал оператору |
| Исчерпаны попытки | Dead блокирует следующий event этого потока |

## Переход на Kafka

1. Ввести транспортный порт и publisher, не меняя бизнес-операции и eventId.
2. Один topic на поток контекста/агрегата, пример `warehouse.receiving.events`.
   Все версии одного агрегата идут в один topic; key — `aggregateId`.
3. Зарегистрировать consumer groups по стабильному имени обработчика.
   Consumers валидируют envelope и atomically фиксируют DB effect + processed marker.
   Offset подтверждают после commit; обработка одной partition последовательна.
4. Publisher подтверждает delivery только после broker ack (`acks=all`).
   Producer idempotence полезна, но не устраняет дубликаты при рестарте publisher.
5. Обеспечить одного активного publisher на stream. В отличие от DB handler,
   lease не может отменить уже отправляемый сетевой запрос: истёкший lease
   не гарантирует fencing старого publisher. При потере владения publication
   останавливается; consumer cursor не допускает применения старых версий и
   обгонов. Конкретный механизм лидерства/fencing проверить отдельным spike
   перед включением нескольких publisher replicas.
6. Для первого Kafka-релиза publisher — одна replica; HA требует отдельного
   подтверждённого протокола и failure tests. Consumer groups не дают автоматического
   exactly once для PostgreSQL.

## Переключение без двойных эффектов

Остановить приём изменяющих команд, завершить/припарковать локальные доставки,
остановить локальных workers. Зафиксировать cutover boundary в БД и backup.
Для новых событий создать Kafka destination; незавершённые старые передать явно,
сохранив eventId. Старые завершённые события повторно не публиковать по умолчанию.
Consumers сохраняют прежние logical consumer names и processed markers.
Запустить publisher и consumers, проверить lag и бизнес-инварианты, открыть запись.
Не менять destination массовым UPDATE при работающих старых workers.
Rollback после появления Kafka-эффектов требует нового согласованного boundary.

## Replay и хранение

Replay — отдельная управляемая операция с диапазоном, причиной и consumer name.
Обычный replay сохраняет eventId и deduplication. Пересборка новой read model
использует новое имя consumer; повтор внешних эффектов автоматически запрещён.
На первом этапе outbox и processed markers не удаляем. Retention вводится вместе
с политикой replay: удаление markers раньше возможного повтора нарушает гарантию.
Kafka retention, backup и archive согласуются до внешнего стенда.
