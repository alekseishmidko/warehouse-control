# 0011. Runtime event contracts, generation и предел первой приёмки

- Дата: 2026-10-21
- Статус: Accepted
- Уточняет реализацию ADR-0004 и неопубликованный контракт ADR-0010; не заменяет их.

## Контекст

До outbox нужен один проверяемый контракт producer и handler. TypeScript не
проверяет JSON runtime, а независимые handwritten schemas/types расходятся.
Нужно заранее ограничить размер документа, оставив возможность optional extensions.

## Решение

Ajv 8.20.0 draft 2020-12 + ajv-formats 3.0.1 full, strict без coercion/defaults/removal.
Схемы Git — source of truth, json-schema-to-typescript 16.0.0 генерирует типы;
тот же script генерирует runtime schema bundle, пригодный для dist без docs.
Локальный code registry выбирает точный type/version. Это не внешний Schema Registry.
Общий EventContracts в backend shared обслуживает обе границы. При втором реальном
приложении-потребителе переносим capability в packages, не создаём пустой пакет сейчас.

ReceivingPosted v1: 1..1000 строк, quantity 1..2147483647, весь JSON UTF-8 <=256 КиБ,
UTC с Z, UUID formats. Максимум строк берётся из generated schema и доступен будущему
receiving DTO; payload DTO — alias generated type. Большой документ разделяется до
проведения, события одного posting автоматически не дробятся. Ограничения добавлены
до первой публикации, дальнейшее сужение требует новой major-версии.

Unknown optional fields сохраняются; неизвестные type/version — permanent refusal.
prepareForOutbox возвращает проверенный JSON snapshot, parseForHandler проверяет
bytes до разбора и полную schema до допуска handler. Реальные вызовы writer/worker
появятся в WMS-106/109, не имитируются в WMS-105. Generation diff — локальный test
gate, без обещания уже настроенного CI или breaking-change comparison.

## Альтернативы

Zod потребовал бы сменить источник контрактов или отдельную конвертацию schemas.
Ручные TS interfaces дублируют schema. Импорт docs JSON runtime привязывает dist к
дереву репозитория. Внешний Registry относится к Kafka-этапу. Запрет unknown fields
сломал бы добавление optional fields в рамках версии.

## Последствия и проверки

JSON Schema и TS имеют разную выразительность: formats, integer и bounds гарантирует
runtime, не TS. Generator используется на проверенном поднаборе schema keywords.
Message limit не ограничивает уже созданный объект producer и не заменяет transport
limit. Duplicate JSON keys следуют JSON.parse (последнее значение), входные объекты —
JSON.stringify. Business invariants проверяются сервисом-владельцем, не Ajv.
Проверки fixtures, boundary values, UTF-8 bytes, missing/stale generation проходят без
Docker. Реальные rollback/delivery/worker tests обязательны на последующих задачах.

Источники, проверенные при реализации: [Ajv dialect](https://ajv.js.org/json-schema.html),
[formats](https://ajv.js.org/guide/formats), [options](https://ajv.js.org/options),
[generator API и ограничения](https://github.com/bcherny/json-schema-to-typescript).
Настройка и движение данных — [README capability](../../apps/backend/src/shared/events/README.md).
