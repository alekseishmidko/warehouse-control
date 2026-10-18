# 0008. Явный transaction context и append-only audit

- Дата: 2026-10-19
- Статус: Accepted
- Уточняет ADR-0002, не заменяет его.
- Частично Superseded by [ADR-0009](0009-nest-service-repository-default.md): отдельный AuditWriter port/adapter заменён AuditService/AuditRepository; остальные гарантии сохраняются.

## Контекст

WMS-103 требует передавать одну транзакцию между application interfaces,
атомарно писать аудит и запретить изменение истории runtime-ролью.

## Решение

Opaque port/context в shared, Drizzle binding и AsyncLocalStorage scope — в infrastructure.
Orchestrator вызывает run, адаптеры заимствуют client. Nested run и stale context
отклоняются. Auto retry отсутствует; повтор 40001/40P01 допускается только целым
replay-safe сценарием по будущей явной политике.

Audit module получает context, валидирует input, фильтрует changes по allowlist
и делает INSERT без собственной транзакции. Timestamp и UUID генерирует БД.
Reason — технический код, не free-form текст. Неизвестные/unsafe поля удаляются.

Новая custom SQL migration создаёт/проверяет NOLOGIN warehouse_app permission group,
выдаёт SELECT/INSERT на audit и устанавливает reject UPDATE/DELETE/TRUNCATE trigger.
Отдельный runtime login provisioned вне schema migration; текущий dev Compose
по-прежнему использует admin URL. Admin может обойти trigger, это не tamper-proof журнал.

## Альтернативы

Глобальная неявная транзакция скрывает зависимость модулей. Публичный ORM handle
в context связывает application с Drizzle. Отдельный commit аудита допускает потерю
истории. Одни grants не защищают от случайного DML владельца, один trigger не заменяет
разделения ролей. Неограниченный автоматический retry повторяет внешние эффекты.

## Последствия и проверка

Нужны явная передача context, дисциплина await и отдельные migration/runtime logins.
Migrations с group provisioning требуют CREATEROLE или заранее подготовленной группы.
Test cleanup disposable БД выполняется owner с явным обходом trigger, не runtime.
Проверяем реальную PostgreSQL атомарность/права и pure validation/redaction.
Правила и ограничения: [transactions](../transactions.md).
