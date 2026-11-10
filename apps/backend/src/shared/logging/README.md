# Контракт логирования

## Бизнес-назначение

Операционный лог помогает найти технический сценарий и не заменяет AuditService.

## Техническое устройство

`log-contract.ts` задаёт фиксированные события/уровни/сообщения и scalar allowlist.
Shared не зависит от Nest/Pino/БД. UUID, W3C hex IDs и неотрицательные длительности
проверяются до передачи adapter. Cookie, payload, actor и raw errors не сериализуются.

Данные: caller → safeLogFields → infrastructure sink. Некорректное поле опускается.
Child context наследует только разрешённые поля. Example:
`logger.child({ correlationId }).emit('operation.started')`.
Успешный commit нельзя объявлять до завершения runner. Infrastructure adapter буферизует
business facts внутри callback и выводит их после COMMIT. Runtime API/worker/CLI подключён;
OTel и жизненный цикл sink принадлежат infrastructure, shared не импортирует их.
Тесты: test/unit/logging.spec.ts. Владелец I/O — infrastructure/logging.

[Подробный flow и границы](../../../../../docs/flows/logging.md).
