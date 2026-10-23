# 0014. Приёмка: immutable состав и атомарное проведение

- Дата: 2026-10-23
- Статус: Accepted
- Уточняет ADR-0010/0011/0012/0013; прежние решения сохраняются.

## Контекст

Нужен первый пользовательский сценарий поверх stock, audit, outbox и HTTP dedup.
Разные ключи HTTP не защищают один документ от двух одновременных проведений.
Событие уже ограничено 1000 строками/int4/256 КиБ; ORM-модель не должна стать API.

## Решение

Документ фактической приёмки имеет draft → posted, одну receiving location своего
склада, 1..1000 строк, один productId на документ, quantity 1..2147483647.
Состав создаётся атомарно и не редактируется через API; нет ожидаемых количеств,
частичного posting, delete/cancel или внешнего номера поставки. Новые документы
с другим create key считаются разными фактическими приёмками.

ReceivingModule следует ADR-0009: controller/services/repositories/dto.
HttpCommandsService владеет command transaction; receiving.create/post только
заимствуют context. ReceivingService.get отдельно владеет read run. Справочники
вызываются через их сервисы; warehouse existence доказывается location ownership/FK.
InventoryService единолично пишет остаток и движение; receiving — документ и событие.

Posting сначала SELECT receipt FOR UPDATE, затем проверка draft и строк. Балансы
захватываются по productId. Inventory audit/movement, receipt audit, outbox counter/event/
stream/delivery, posted status и HTTP result фиксируются вместе. UUID строки — стабильный
inventory operationId. Event aggregateId/payload.receiptId совпадают с receipt.id,
postedAt = occurredAt; первое и единственное событие документа имеет version=1.
Одинаковый HTTP key получает прежний response, новый key на posted — 409.
Автоматических retry и внешнего I/O внутри транзакции нет.

SQL guards запрещают изменение строк, переписывание posted, DELETE/TRUNCATE истории;
INSERT строки проверяет draft под parent lock. Runtime grants минимальны; DBA может
обойти triggers. Оркестрацию inventory/audit/event обеспечивает сервис и integration tests,
а не попытка реализовать весь сценарий в SQL triggers. Компенсация/retention — отдельные решения.

## Альтернативы

- Только HTTP dedup: не защищает два разных ключа на одном документе.
- Optimistic status UPDATE после stock: потребует отката проигравшего и усложнит
  порядок проверки; parent lock даёт явную точку сериализации до эффектов.
- Разрешить одинаковый productId несколькими строками: возможно, но требует правил
  агрегирования/номеров поставщика; в первом сценарии duplicate отклоняется.
- Редактор draft/частичная приёмка: требует version/concurrency API и отдельной модели
  ожидаемой поставки, не нужен для текущего вертикального сценария.

## Последствия и проверка

Большая приёмка делится до posting, компенсирующие документы ещё не реализованы.
1000 строк — верхний технический лимит, performance/SLO пока не измерены.
Production auth/ACL, worker и putaway task отсутствуют; dev actor остаётся локальным opt-in.
Тесты реального PostgreSQL проверяют row/unique waits, rollback после каждого SQL шага
и replay. [Модуль](../../apps/backend/src/modules/receiving/README.md),
[демонстрация](../receiving.md), [отчёт](../reports/wms-108.md).

Обоснование row lock/read committed:
[официальная документация PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html).
