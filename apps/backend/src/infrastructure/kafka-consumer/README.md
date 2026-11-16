# Kafka consumer inventory.putaway

## Для менеджера

Получает факт проведённой приёмки и создаёт задания размещения через существующий
InventoryService. Повтор сообщения не повторяет задания или начисление остатка.
Проведение приёмки остаётся синхронной PostgreSQL-командой. Недоступность Kafka
задерживает задания, но не отменяет уже подтверждённую приёмку.

Gap, неверное сообщение или DB ошибка останавливают consumer без подтверждения
ошибочного offset. Автоматического пропуска нет; расследование обязательно.

## Для разработчика

`consumer.ts` — отдельный opt-in executable. `KafkaConsumerModule` импортирует
DatabaseModule/ApplicationConsumerModule и общий ApplicationConsumerService. Local WorkerLoop не
запускается. `consumer.config.ts` проверяет opt-in/mTLS/budgets, `kafka-consumer.ts`
владеет KafkaJS group/heartbeat/offset, `services/kafka-message.service.ts` — границей
record → validated event → PostgreSQL transaction. Private worker repository не импортируется.

Общий ReceivingPostedHandler вызывается через application service. Identity
`inventory.putaway` совпадает с local destination и Kafka group; markers/cursor
сохраняются. Нового DDL, изменения envelope и writer нет. Message сверяется с retained
outbox: внешние producers с чужими событиями не поддерживаются.

Полный flow, Mermaid, доверие к входу, пошаговые данные, ошибки, примеры и запуск —
[Kafka consumer flow](../../../../../docs/flows/kafka-consumer.md). Решение и последствия —
[ADR-0035](../../../../../docs/adr/0035-kafka-application-consumers.md).

## Проверки

`test/integration/kafka-consumer.spec.ts`: настоящий mTLS broker/PostgreSQL, business
state, duplicate, marker failure rollback, gap, rebalance barrier, child SIGKILL,
retained cursor N+1, root pnpm startup и Node SIGTERM exit0. Unit guards —
`test/unit/kafka-consumer-config.spec.ts`; прежние worker/putaway suites проверяют
общий application service на старом transport. Child-process исполнение отдельно
не добавляется к Jest runtime coverage; это ограничение измерения, не отсутствие проверки.
