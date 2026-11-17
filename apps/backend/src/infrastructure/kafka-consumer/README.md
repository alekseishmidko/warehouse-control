# Kafka consumer и recovery

## Для менеджера

Consumer создаёт задания размещения через прежний InventoryService. Повтор не начисляет
stock и не создаёт второе задание. Сбой Kafka не отменяет подтверждённую приёмку.

WMS-505 добавляет opt-in encrypted quarantine. Ошибка блокирует свою partition:
другие документы в ней ждут, другие partitions продолжают работу. Оператор исправляет
причину и явно разрешает retry; quarantine не является successful business fact.

## Для разработчика

KafkaConsumerModule подключает общую ApplicationConsumerModule и KafkaMessageService.
KafkaRecoveryService владеет gate/failure/admin transactions; QuarantineRepository
внутренний, AuditService импортируется публично. QuarantineCrypto выполняет fs/crypto
до DB callback; raw запрещён в logger/stdout. Custom migration0034 владеет SQL-таблицей
kafka_quarantine; ORM schema для неё не создаётся. Комментарии каждого поля находятся
в migration. Это новые DDL; applied migrations не изменялись.

Существующий consumer без CONSUMER_RECOVERY_ENABLED сохраняет fail-stop WMS-504 и
не требует encryption key. Существующие durable gates проверяются независимо от этого
флага. Новый профиль явно включает encrypted failures, bounded retry и partition pause.
Отключение флага не сбрасывает gate или markers/cursor.

Полный flow, Mermaid, права, env, команды, rollback/rebalance и recovery:
[владелец flow](../../../../../docs/flows/kafka-consumer.md). Согласованное исключение
хранения raw — [ADR-0036](../../../../../docs/adr/0036-dev-kafka-quarantine-storage.md).

## Проверки

kafka-consumer.spec.ts использует настоящие Kafka mTLS/PostgreSQL и root pnpm commands:
duplicate/crash/rebalance/N+1, poison isolation, restart с offset после заблокированного,
retry с прежним eventId, audit rollback, export0600, cleanup и отсутствие body в logs.
quarantine-crypto.spec.ts проверяет binary/null/headers, authenticated source address,
лимит bytes и private key file. Native SDK mocks kafka-consumer-adapter.spec.ts проверяют
узкие race/int64 cases; они не заменяют реальные migration/SQL/broker tests.

Child-process coverage CLI не объединён с Jest V8; ручной review/commands и критерии —
[отчёт WMS-505](../../../../../docs/reports/wms-505.md). Quarantine не является backup,
production retention/storage/key custody требуют отдельного согласования.
