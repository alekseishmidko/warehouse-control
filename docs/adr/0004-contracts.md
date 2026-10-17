# 0004. Явные контракты API и событий

- Дата: 2026-10-17
- Статус: Accepted

## Контекст

Frontend, workers и Kafka consumers должны переживать независимые обновления.

## Решение

HTTP: runtime-validated DTO и генерируемый OpenAPI, клиент генерируется.
События: JSON Schema 2020-12 в Git, типы генерируются, вход проверяется runtime.
Версионированный envelope, совместимость и fixtures проверяются в CI.
Registry/AsyncAPI вводятся на Kafka-этапе после проверки dialect/tooling.

## Альтернативы

Общие ORM-классы протаскивают внутреннюю модель. Только TS interfaces
не проверяют данные runtime. Avro/Protobuf пока не выбраны: JSON проще
для первой реализации и диагностики.

## Последствия и проверка

Генераторы и compatibility gates требуют настройки; до этого они не считаются
существующими. Breaking changes получают major-версию и период совместимости.
Правила и пример: [contracts](../contracts/README.md). Этапы 1, 2, 5.
