# 0010. Int4 stock quantity и минимальное внутреннее начисление

- Дата: 2026-10-19
- Статус: Accepted
- Уточняет модели/диапазон WMS-104; не отменяет транзакционные правила ADR-0002/0008.

## Контекст

Нужен первый реальный stock baseline до outbox и документов приёмки. Нужно
защитить отсутствующий balance при гонке и определить одинаковый quantity контракт
для SQL, JavaScript и draft события. API без auth открывать нельзя.

## Решение

Одна организация, unit piece, SQL integer, quantity 1..2147483647, balances 0..MAX.
Общий numeric contract в shared. Сужена неопубликованная draft v1.quantity schema;
после первой публикации такое изменение требует major-version.
Catalog и Warehouses владеют справочниками; только InventoryService меняет stock.
Зона — kind location, отдельная Zone entity пока не нужна.

Composite FK защищает warehouse/location consistency, unique stock key и guarded
ON CONFLICT DO UPDATE сериализуют конкурентное создание/увеличение. Reserved
начислением не меняется. Movement связан с audit, operationId unique для одной
строки; повтор отклоняется с rollback, а не возвращает прежний результат.
Audit/movement/balance атомарны через existing context. Outbox добавится позже.
Runtime movement только SELECT/INSERT, immutable trigger отклоняет обычный DML владельца.

Dev fixtures — guarded CLI без HTTP: новые данные через сервисы и audit, без stock seed.
Модули используют controller→service→repository с отдельными services/repositories/dto;
контроллеры не создаются до необходимости.

## Альтернативы

Bigint требует другого JSON/JavaScript контракта либо ограничений на number;
numeric нужен для дробных единиц, которых пока нет. SELECT FOR UPDATE не блокирует
несуществующую строку; ручной read-modify-write теряет изменения без дополнительного
протокола. Zone entity и публичный CRUD не нужны текущему сценарию.

## Последствия и проверка

Ограничение MAX относится к одному balance, не к сумме по всем складам. Увеличение
диапазона/дробность требуют миграций и проверки контрактов. Движения нельзя исправить
UPDATE. DBA всё ещё способен обойти защиту, module ownership — правило приложения.
Реальные тесты гонки с barrier, overflow, repeat и FK/CHECK; scope/rollback сохранены.
[Подробности](../stock-baseline.md).
