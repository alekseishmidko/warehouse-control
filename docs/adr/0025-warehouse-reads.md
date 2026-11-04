# ADR-0025. Складские read API и история

- Дата: 2026-11-04.
- Статус: Accepted как реализация порученного WMS-207.
- Дополняет ADR-0009/0019, не меняет матрицу прав и владельцев записи.

## Решение

API читает один явно заданный склад. Общий API-only controller вызывает публичные
ReadService модулей. Каждый private ReadRepository перечисляет собственные DTO
поля; прямых межмодульных записей нет. AuditReadRepository читает retained связи
объектов для warehouse scope полиморфной истории. Это локальное read-only исключение
для JOIN, без доступа к чужим repositories и без введения общего доменного repository.

Ключ страницы — UUID для таблиц без createdAt либо (timestamp,UUID) для истории.
Timestamp сохраняет PostgreSQL microseconds. Default limit 20, максимум 100;
cursor привязан к ресурсу/фильтрам. Списки не выполняют COUNT и не обещают один
snapshot между HTTP запросами. Права проверяются внутри каждого read run.

ReadModels, реплика и отдельная очередь не вводятся. Список putaway зависит от
commit существующего worker, а не от нового projection consumer. Дополнительные
индексы задаются source schema и новой migration 0032. Applied SQL не меняется.

## Последствия и альтернативы

OFFSET проще, но смещает страницы при вставках и дорожает с глубиной. Keyset
сохраняет неизменную границу, но не предоставляет номер страницы и общий total.
Server-side snapshot/export потребует отдельного lifecycle и политики хранения.
Denormalized warehouse_id у picking/shipment/audit ускорит некоторые запросы,
но добавит инварианты записи и backfill. На этом этапе сохранены существующие FK;
планы проверяются на синтетических production данных, без обещания SLO.

[Подробный флоу и тесты](../flows/warehouse-reads.md), [evidence](../reports/wms-207.md).
