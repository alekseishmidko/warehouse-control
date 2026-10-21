# 0012. Outbox writer, транзакционная версия и первоначальная доставка

- Дата: 2026-10-22
- Статус: Accepted
- Уточняет физическую модель ADR-0003 и подключает validation ADR-0011; прежние гарантии сохраняются.

## Контекст

Перед приёмкой нужен writer с обязательным transaction context: одно событие,
его delivery и stream должны появляться вместе с бизнес-записями. Concurrent
создание первого события не защищается SELECT FOR UPDATE отсутствующей строки.
Версии должны быть непрерывными среди успешно зафиксированных событий агрегата.

## Решение

OutboxModule размещается в infrastructure: OutboxService → private OutboxRepository,
DTO в dto/, public interface — append(context,command), без дополнительного token/port.
Никаких самостоятельных run/commit/pool в writer. Перед INSERT переиспользуется
EventContracts.prepareForOutbox. EventId выделяется локальным randomUUID, version — БД.

К outbox_events/outbox_deliveries/delivery_streams добавляется техническая таблица
outbox_aggregate_sequences с composite PK агрегата и bigint last_version в диапазоне
1..MAX_SAFE_INTEGER. Guarded upsert увеличивает counter под row lock в общей транзакции.
Rollback возвращает версию; PK/unique eventId и aggregate version дополняют протокол.
Preflight snapshot с version=1 фиксирует вход до await, финальный snapshot проверяет
окончательную версию и bytes перед event INSERT. Ошибки append нельзя подавлять.

Первый стабильный destination — inventory.putaway для полного receipt stream,
зарегистрирован в коде и migration CHECK. Новый stream начинается cursor=0;
ON CONFLICT DO NOTHING сохраняет существующий cursor/lease. Каждое событие получает
pending delivery в той же транзакции. Новый consumer требует migration и явного
решения о replay/старте истории, не автоматического подключения ко всем старым событиям.

Envelope JSONB immutable, проверенный JSON сохраняется параметризованным cast:
семантическая идентичность без обещания сохранения whitespace/key order. Триггеры
и grants запрещают UPDATE/DELETE/TRUNCATE событий; остальные outbox rows пока не
удаляются. Никаких TTL/retention jobs до отдельной replay policy. DBA может обойти защиту.

## Альтернативы

nextval не откатывается вместе с транзакцией и даёт пропуски. MAX(version)+1 без
блокировки конфликтует при гонке. Advisory locks потребовали бы протокола ключей;
явная строка counter проще для диагностики и ожидаемого конкурентного обновления.
Использовать delivery stream как общий producer counter означало бы связать
выделение версии со списком destinations. Append после commit оставлял бы окно потери.

## Последствия и проверка

Один агрегат сериализует writers до конца бизнес-транзакции, разные агрегаты
могут идти параллельно. При нескольких агрегатах caller задаёт порядок блокировок;
auto retry не добавлен. Counter/stream не являются состоянием бизнес-документа.
Прямой SQL вне сервисов способен нарушить протокол; runtime доверяет адаптеру,
constraints не повторяют всю JSON Schema и не защищают от администратора.

Реальные PostgreSQL tests проверяют атомарность stock/audit/outbox, поздний delivery
failure, конкурентный первый upsert, фактическое ожидание lock/rollback/reuse,
unique/FK/check, byte/version bounds, runtime grants и owner triggers.
Worker/dedup/claim/lease/recovery и Kafka не реализованы этой задачей.

Источники: [PostgreSQL 17 ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html),
[Drizzle guarded upsert](https://orm.drizzle.team/docs/guides/upsert).
Движение данных/эксплуатация: [README outbox](../../apps/backend/src/infrastructure/outbox/README.md).
