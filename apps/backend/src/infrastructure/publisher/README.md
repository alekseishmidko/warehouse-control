# Outbox publisher

## Бизнес-назначение

Надёжная доставка retained событий в Kafka без зависимости складского commit от
broker. Не выполняет складские эффекты и не заменяет local worker до cutover.

## Техническое устройство

| Компонент                   | Ответственность                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| publisher.config.ts         | Проверяет opt-in/mTLS/timeouts и возвращает закрытый code при неверной конфигурации.           |
| dto/publisher-record.dto.ts | Передаёт snapshot попытки между repository и service; envelope остаётся unknown до проверки.   |
| PublisherRepository.acquire | Держит одну PG session и доказывает полноту истории; не подключает Kafka.                      |
| PublisherRepository.next    | Выбирает cursor+1, регистрирует delivery/stream и фиксирует новый token одной SQL transaction. |
| PublisherService            | Проверяет schema/identity и вызывает transport между claim commit и completion transaction.    |
| KafkaEventTransport         | Реализует shared/transport port; отвечает за ack, broker epoch и partition mapping.            |
| src/publisher.ts            | Владеет сигналами, probes и закрытием Kafka перед освобождением PG owner.                      |

`assertRetainedHistory`, `findNextEvent` и `persistAttempt` — приватные шаги протокола.
Их разделение не вводит новые transactions и не допускает parallel tick. Повторный
claim processing безопасен только после session lock, а не по факту истечения lease.

Полные шаги, Mermaid, запуск, ошибки, recovery, пример и границы находятся у
[владельца flow](../../../../../docs/flows/publisher.md), решение — ADR-0034.

## Проверки

`test/integration/publisher.spec.ts`: настоящие migrations/PostgreSQL и mTLS Kafka,
ack barrier, lost ack, crash, order, singleton, outage/business commit. Никаких raw
payload/driver errors в operational logs. Пробы не являются гарантией доставки.

## Диагностика

`process.failed` различает неверную конфигурацию по `PUBLISHER_*` code.
Код передаёт только `PublisherConfigurationError`; произвольный Error.message/code
не отражается в logs. Общий logging allowlist хранит закрытый список кодов, включая
`KAFKA_UNCONFIRMED`. Значения env, PEM и driver errors не выводятся.
