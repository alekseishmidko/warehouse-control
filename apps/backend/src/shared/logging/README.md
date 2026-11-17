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

Конфигурационные `PUBLISHER_*` коды заданы в PUBLISHER_CONFIG_ERROR_CODES этого контракта;
infra config не передаёт в logger текст Error/env. Закрытый SAFE_ERROR_CODES Set создаётся
один раз и сохраняет KAFKA_UNCONFIRMED, не разрешая неизвестные строки по префиксу.
Regression: test/unit/logging.spec.ts проверяет реальный Pino JSON и canary rejection.

WMS-505 добавляет server UUID quarantineId и integer partition0..2 в safe scalar fields.
Они связывают durable failure с admin inspect; ciphertext/raw/headers/key по-прежнему
не входят в контракт. Новые fixed events — consumer.partition_retry/partition_blocked.
