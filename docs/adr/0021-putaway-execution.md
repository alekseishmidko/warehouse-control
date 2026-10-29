# 0021. Полное выполнение задания размещения

- Дата: 2026-10-29.
- Статус: Accepted в рамках реализации WMS-203.
- Уточняет [ADR-0016](0016-durable-putaway-handler.md): создание остаётся идемпотентным,
  immutable основание сохраняется, вместо полностью immutable task разрешён один переход выполнения.

## Решение

Выполняем полное quantity одного PutawayTask из receiving в storage того же склада.
Клиент передаёт только targetLocationId; source/product/quantity/warehouse определяются сохранённым заданием.
Partial execution, отмена, межскладской перенос и публичная произвольная transfer-команда в этот шаг не входят.
Разрешено только свободное количество: quantity <= source.onHand-source.reserved. Reserved не переносится
и не уменьшается. Новые правила перемещения allocation потребуют отдельного решения при WMS-204/205.

Сценарий владеет одним command context: task FOR UPDATE, две balance позиции, debit/credit,
audit, пара movements, outbox факт, task completed и saved HTTP response — один commit.
Отсутствующие balances создаются нулевыми в том же порядке ключей, что row locks;
сортировка только существующих rows не покрыла бы гонку unique INSERT.

Movement сохраняет положительное int4 quantity и прежний unique operationId. Transfer имеет два
новых operationId, общий transferId=taskId и kind transfer-out/transfer-in. UNIQUE(transferId,kind),
FK, state guard и deferred pair check не разрешают commit половины пары/незавершённого задания.
Audit создания task не заменяется: есть отдельный completionAuditId.

Событие inventory.putaway-completed v1 принадлежит агрегату putaway-task с aggregateId=task.id.
Receipt stream/version и его полный inventory.putaway consumer не изменяются. У нового агрегата
пока нет подписчиков: событие retained в outbox без фиктивной delivery. Это сохранённый факт,
а не обещание выполненной внешней доставки. Новый consumer требует replay/start-position плана,
как и прежде; удалять эти события до retention/replay policy нельзя.

Identity/Idempotency/HTTP подключены через InventoryHttpModule только в AppModule. InventoryModule
остаётся владельцем stock и публичного InventoryService; worker использует его без человеческой
auth policy. Это adapter composition одного модуля, не новый bounded context/микросервис.

## Альтернативы и последствия

Один signed movement упростил бы таблицу, но нарушил бы существующий positive quantity контракт
и не выражал бы обе позиции. Повторно использовать один operationId для обеих строк нельзя из-за
существующего unique; менять его для receipt не требуется. Событие receipt stream смешало бы
владельца задания с документом приёмки. Фиктивный handler добавил бы неподтверждённую бизнес-работу.

Старые данные остаются pending, completion поля NULL, receipt movements имеют transferId NULL.
Только новые migrations 0020/0021 меняют constraints/grants; applied SQL не переписывается.
DBA способен обойти triggers. Проверка SQL evidence не доказывает физическое действие оператора:
API подтверждает введённое человеком размещение, датчиков/сканера в проекте нет.

[Флоу, ошибки и evidence](../flows/putaway-execution.md).
