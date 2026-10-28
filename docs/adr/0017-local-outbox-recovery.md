# 0017. Локальные inspect/retry/signal и сохранение бюджета попыток

- Дата: 2026-10-28
- Статус: Accepted
- Уточняет ADR-0015/0016; token/marker/cursor протокол и immutable event сохраняются.

## Решение

OutboxModule экспортирует OutboxRecoveryService вместе с writer. Private RecoveryRepository
обслуживает административные outbox операции; CLI без HTTP/worker startup. Доступ CLI только
при explicit NODE_ENV development/test, OUTBOX_ADMIN_ENABLED=true и loopback DATABASE_URL.
Каждый service вызов дополнительно проверяет membership warehouse_outbox_admin. NOLOGIN
group получает только необходимые grants; runtime warehouse_app не получает права recovery
history INSERT и изменения budget base. Migration owner/dev superuser может администрировать.

Operator UUID и reasonCode обязательны. Это утверждение локального OS/DB оператора,
не аутентификация личности: production identity/RBAC и remote admin API не реализованы.
Loopback не доказывает физическую локальность БД за tunnel, credentials/provisioning внешние.
Существующие runtime UPDATE grants outbox не считаются защитой от злонамеренного raw SQL;
сервисные проверки и column guard обеспечивают штатный протокол, DBA может обойти guards.

Retry адресует ровно eventId+consumer. NOWAIT stream/delivery locks не ждут активного handler.
Требуются dead, отсутствие работающего lease, marker и продвижения consumer за event,
transport cursor=consumer cursor=event version-1. Запрещены bypass predecessor, сброс истории,
запуск handler из admin transaction и retry processing даже с expired lease: его восстанавливает
обычный worker. Retry/audit/append-only outbox_recovery_actions фиксируются атомарно.

Attempts остаётся общим монотонным int4 counter. Новый retry_attempt_base отмечает attempts
на момент одобренного вмешательства, а worker budget/backoff считает attempts-base. Иначе
исчерпавшая maxAttempts delivery немедленно вернулась бы в dead после административного retry.
History хранит прежние attempts/base/error, operator/reason, administration correlation и auditId.
Envelope, eventId, markers, cursors, task и last_error при scheduling не переписываются.
При пределе int4 retry отклоняется, а не создаёт бесконечный overflow claim.

Inspect по умолчанию исключает payload. --payload возвращает только validated UUID/quantity
первых десяти строк и lineCount, без unknown extensions; invalid envelope скрыт целиком.
Fencing token не печатается, lease status/until доступны. Source correlation/error sanitization
и поля eventId/stream/consumer/attempt общие в shared/diagnostics. Worker пишет NDJSON после
commit; sink failure не меняет DB outcome. Это локальный diagnostic sink, не Pino/Loki stack.

Signal — один локальный SQL snapshot dead/active backlog/blocked streams/expired processing/
oldest age. Node CLI exit=0 healthy, 2 alert, 1 failure/denial. Внешние каналы не вызываются;
их настройка — отдельная работа WMS-401/402. psql/manual reset/replay данным решением не разрешены.

## Альтернативы и проверка

Reset attempts стирает историю; retry без нового budget сразу снова dead. Массовый retry,
reset cursor/marker и изменение envelope нарушают порядок/дедупликацию. Ожидание активного
lock скрывало бы живой handler; NOWAIT даёт явный DELIVERY_BUSY. Только stdout audit теряется
при crash, поэтому вмешательство сохраняется в DB с AuditService и immutable record.

Real PostgreSQL tests проверяют role, active leases/locks, cursors/markers, concurrent operators,
fault каждого administrative SQL шага, границы counter и redaction. CLI runbook проверяется
в disposable БД командой pnpm outbox:recovery-check, без failure flags в production handler.
[Флоу](../flows/outbox-recovery.md), [runbook](../runbooks/event-recovery.md).

Источники: [PostgreSQL 17 role checks](https://www.postgresql.org/docs/17/functions-info.html),
[locking / NOWAIT](https://www.postgresql.org/docs/17/sql-select.html).
