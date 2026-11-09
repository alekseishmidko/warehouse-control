# ADR-0029: probes, bounded drain и перекрытие релизов

Статус: принято для WMS-304. Уточняет [ADR-0005](0005-platform.md),
[ADR-0015](0015-postgres-worker.md) и [ADR-0028](0028-kubernetes-release-migrations.md).
Бизнес-правила B1–B4 и контракт доставки at least once сохраняются.

## Решение

Startup означает завершение init, liveness — ответ event loop без внешних сервисов,
readiness — отсутствие drain и доступность PostgreSQL. Probes не предоставляют
бизнес-доступ и не раскрывают credentials. Worker имеет listener9100 без Service.
API сохраняет /health для существующих consumers и добавляет три отдельных маршрута.

API управляет signals до startup, прекращает новые requests и ждёт active responses
до pool.close; общий предел20s. DB transaction/statement по умолчанию ограничены10s;
worker задаёт собственный timeout10s, shutdown15s. Kubernetes grace30s.
Превышение process deadline означает exit1, закрытие sockets и rollback БД.

RollingUpdate использует maxUnavailable0/maxSurge1, readiness и minReadySeconds3.
Перекрытие workers разрешено: stream locks, lease token, marker/cursors/ack защищают
один DB effect. Время lease проверяется отдельным statement после получения locks.
Сериализованный pre-upgrade migrator не заменяет expand/contract compatibility:
добавочная nullable schema должна поддерживать прежние процессы до окончания rollout.

## Последствия

DB outage снимает readiness, сохраняя живые процессы. Surge требует дополнительного
места single-node стенда. Сетевое прекращение запросов не доказывает rollback после
commit; исходный key обязателен при неизвестном результате. Механизм не гарантирует
нулевой HTTP error rate при удалении Pod, глобальный порядок или exactly once.
Single-node PostgreSQL/PVC не обеспечивает HA. Kafka fencing этим решением не задан.

API preStop в Kubernetes ждёт5s после начала Pod termination для распространения
EndpointSlice/Gateway. Бюджет5s + API deadline20s укладывается в grace30s;
при прямом Docker SIGTERM preStop отсутствует, process deadline остаётся20s.
