# Cursor pagination

Технический контракт для списков. `preparePageRequest` связывает cursor с маршрутом,
складом и фильтрами. Limit 1..100, default 20. `encodePageCursor` кодирует ключ в base64url.
Cursor не секрет и не авторизация. Права проверяются заново на каждой странице.
Ошибки — VALIDATION_FAILED. SQL выполняет infrastructure, правила фильтров задаёт владелец.
[Флоу, ограничения и тесты](../../../../../docs/flows/warehouse-reads.md).
