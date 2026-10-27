# Восстановление обработки событий

Проектный runbook: административные команды пока не реализованы.
Не выполнять произвольные SQL reset/update по этому документу.

Реализация и проверка этого runbook запланированы в
[плане разработки](../development-plan.md): WMS-111 — inspect/retry,
WMS-404 — recovery drill, WMS-506 — переключение на Kafka.

## Для менеджера и координатора инцидента

Если подтверждённая операция не приводит к следующему заданию, зафиксировать
документ/заказ, время и correlationId и передать оператору. Не проводить документ
повторно и не менять остатки ради ремонта очереди. Задержка доставки не отменяет
подтверждённую складскую операцию.
Оператор сообщает затронутые процессы, масштаб и время следующего обновления.
Сроки реакции пока не утверждены. Инцидент закрывается после проверки бизнес-результата,
отсутствия двойного начисления/списания и восстановления заблокированного потока.

## Диагностика

По eventId/correlationId найти outbox event, destination, попытки, последний error,
lease и stream cursor. Проверить схему, DB health, блокировки и backlog.
Для Kafka дополнительно проверить broker availability, publisher ack и group lag.
Наличие event в broker не означает выполненный DB effect.

## Retry после исправления

1. Устранить причину: код, схема, конфигурация или доступность зависимости.
2. Проверить processed marker и фактический бизнес-эффект.
3. Управляемой командой вернуть конкретную delivery из dead в retry,
   сохраняя eventId, историю попыток и причину вмешательства.
4. Не пропускать следующую версию заблокированного агрегата.
5. Проверить результат, cursor и спад backlog; записать действие в audit.

Lease не сбрасывать вручную, пока старый обработчик может работать.
Для Kafka publisher перед передачей владения гарантировать остановку старого процесса.

## Replay

Указать диапазон, consumer и цель. Обычный replay не очищает processed_events.
Для новой read model создать новый consumer name и изолированную проекцию.
Перед повтором внешних эффектов нужен отдельный план компенсации/idempotency.

## Cutover на Kafka

Остановить запись → завершить локальных workers → backup и boundary →
перенести незавершённые доставки с прежними eventId → запустить Kafka путь →
проверить эффекты/markers/cursors → открыть запись.
При ошибке не включать два пути одновременно. После новых эффектов rollback
требует явного нового boundary, а не простого переключения env variable.


## Реализованный baseline WMS-109

Автоматически восстанавливается истёкший lease processing delivery, если её stream
не заблокирован активной transaction. Token меняется; stale process не может ack/fail
нового владельца. Ошибка rollback-ит effect/marker/cursors, отдельный run ставит retry/dead.
Expired claim с исчерпанным budget тоже dead; следующий event того же потока заблокирован.
Permanent code/attempts/DB deadline — durable evidence; raw payload/credentials не логируются.

Production registry содержит inventory.putaway WMS-110. Долго pending delivery без task
требует проверки worker, lease, last_error и DB health. Completed delivery с pending task —
успешное создание задания, а не отказ очереди: физическое размещение ещё не реализовано.
Сам handler не меняет приёмочный stock; проверьте receipt → event → task по read-only SQL.
SIGTERM drain/deadline и SIGKILL recovery проверены child-process integration tests;
ручной reset/replay/admin CLI по-прежнему не реализован и этим runbook не разрешён.
[Конфигурация/протокол](../../apps/backend/src/infrastructure/worker/README.md).

WMS-110 диагностика: [putaway-result.sql](../examples/putaway-result.sql),
[состояния/сбои](../flows/putaway.md). Unknown source FK и conflicting event для существующей
line — permanent dead, не повод менять stock или генерировать новый eventId. API inspect/retry
ещё не реализован; этот документ не разрешает manual reset markers/cursors/tasks.
