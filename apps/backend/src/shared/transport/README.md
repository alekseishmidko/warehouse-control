# Event transport port

## Назначение

Техническая граница доставки immutable события; бизнес-writer не знает о broker.
Потребитель — infrastructure/publisher. `publish` завершается после broker commit ack,
но не подтверждает PostgreSQL completion и не обещает exactly once.

## Взаимодействие и ошибки

Service передаёт KnownEvent после schema/identity validation. Adapter не меняет
payload/eventId, не обращается к SQL. Unknown ack возвращается ошибкой; caller
сохраняет retry с прежним ID. `connect/close` принадлежат process lifetime.

Пример: PublisherService.tick → EventTransport.publish → repository.complete.
Шаги/Mermaid/recovery: [flow](../../../../../docs/flows/publisher.md).
Интеграционные проверки: test/integration/publisher.spec.ts; реальный Kafka adapter,
а injection только моделирует потерю ack после настоящего broker commit.
