# Инфраструктура backend

Технические адаптеры запуска, конфигурации и PostgreSQL для API и CLI.

## Для менеджера

Обеспечивает проверенный запуск и сохранение технических данных между рестартами.
Реализованы PostgreSQL/outbox, отдельный durable worker и HTTP adapters приёмки, размещения и заказов.
Отсутствие БД запрещает запуск API.
Критерий текущего этапа: миграция повторяема, данные сохраняются, соединения закрываются.

## Для разработчика

- [config](config/README.md): загрузка `.env`, проверка NODE_ENV/PORT/DATABASE_URL.
- [database](database/README.md): pool, Drizzle, Nest adapter, migrate/check CLI.
- [worker](worker/README.md): durable claim/lease/process/retry и shutdown отдельного процесса.
- [http](http/README.md): session boundary/validation/problem mapper.
- [outbox](outbox/README.md): запись события/delivery/stream и counter в caller-owned transaction.

I/O и ORM остаются здесь. Shared не импортирует infrastructure; domain не зависит
от этих адаптеров. WMS-103 добавляет scoped PostgreSQL transaction runner, реализующий shared port.
Правила: [transactions](../../../../docs/transactions.md).
Публичный технический интерфейс сейчас — DatabaseModule/DatabaseService и CLI;
outbox write interface добавлен в WMS-106. Worker claim/process/recovery и HTTP command/idempotency adapters реализованы; бизнес-правила остаются в modules.
Запуск и проверки описаны в дочерних README и [Compose](../../../../infra/compose/README.md).
Логи безопасны по отношению к credentials, полноценная телеметрия ещё не подключена.

WMS-104 добавляет dev fixture builder/CLI и агрегацию module-owned stock schemas.
Builder вызывает экспортируемые сервисы, не пишет в чужие таблицы напрямую.
Справочники/stock модели: [baseline](../../../../docs/stock-baseline.md).

WMS-107 добавляет [HTTP](http/README.md) и [idempotency](idempotency/README.md):
DTO/guards/problem mapper, command transaction и saved response.
WMS-202 заменил временный dev actor настоящими sessions/CSRF/warehouse ACL. Business routes подключены в API graph. JSON hashing/error codes — в shared,
PostgreSQL/HTTP/Nest adapters остаются здесь. OpenAPI генерируется offline из текущего graph.
