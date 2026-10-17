# 0003. Transactional outbox сначала, Kafka затем

- Дата: 2026-10-17
- Статус: Accepted

## Контекст

Нужно изучить надёжную доставку и затем подключить Kafka, сохранив корректность.

## Решение

События пишутся в PostgreSQL вместе с бизнес-операцией. Сначала локальный
durable dispatcher, затем publisher → Kafka → consumers. Outbox остаётся.
At least once, стабильные eventId, processed markers и порядок по агрегату.
Первый Kafka publisher singleton; multi-replica требует проверенного fencing.
Redis/BullMQ не входят в начальный стек.

## Альтернативы

EventEmitter теряет события при сбое. Прямая публикация после commit имеет окно
потери. Debezium CDC — возможное следующее исследование, но сейчас скрывает
часть механики, которую хотим реализовать и проверить самостоятельно.

## Последствия и проверка

Нужны lease, cursors, retries, quarantine, retention и cutover procedure.
Ошибка раннего события блокирует stream. Дубликаты допустимы, двойной эффект — нет.
Протокол: [outbox.md](../outbox.md); failure tests на этапах 1 и 5.
