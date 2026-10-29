# Контрактные fixtures WMS-105

Полные синтетические сообщения для проверки эволюции и отказов, не данные реального склада.
Базовый положительный fixture — [ReceivingPosted](../examples/receiving.receipt-posted.v1.json).

| Файл                           | Отличие от базового примера           | Результат producer и handler validation |
| ------------------------------ | ------------------------------------- | --------------------------------------- |
| receiving.optional-fields.json | Новые поля в envelope, payload и line | Принять и сохранить поля                |
| receiving.unknown-version.json | schemaVersion=2                       | UNSUPPORTED_EVENT                       |
| receiving.invalid-payload.json | quantity=0                            | INVALID_EVENT                           |

Проверяются [event-contracts.spec.ts](../../../apps/backend/test/unit/event-contracts.spec.ts)
через обе реальные точки EventContracts. Остальные негативные варианты и большие
сообщения строятся тестом из базового примера, без копирования всего набора данных.
JSON не поддерживает комментарии; эта таблица документирует назначение каждого файла.
Команда: `pnpm test:unit`, Docker не нужен. Это не worker integration/deduplication test.
