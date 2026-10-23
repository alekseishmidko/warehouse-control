# Этапы реализации

Не начинать следующий инфраструктурный этап до рабочего вертикального сценария.
Этап 1 начат: WMS-101–WMS-108 выполнены; остальные задачи пока не реализованы.

Подробный backlog с ID задач, зависимостями, демонстрациями и критериями перехода:
[план разработки](development-plan.md): 38 задач, разбитых на 217 шагов с чекбоксами.
Этот roadmap остаётся обзором этапов;
статусы детальных задач ведутся в плане без дублирования их описаний здесь.

## 0. Baseline — документация подготовлена

Каркас NestJS и pnpm существует. Архитектура, контракты, ADR и контекст агента описаны.
PostgreSQL/Drizzle, первая миграция и Compose реализованы в WMS-101.
WMS-102 завершена: Jest/Supertest и PostgreSQL Testcontainers harness.
WMS-103 завершена: transaction context/runner, audit и append-only права.
WMS-104 завершена: catalog/warehouses/inventory baseline, quantity/movements и fixtures.
WMS-105 завершена: runtime contracts, локальный registry, TS generation/diff и fixtures.
WMS-106 завершена: outbox writer/counter/delivery/stream в одном context, immutable retention.
WMS-107 завершена: HTTP validation/problems/dev context, command dedup и offline OpenAPI.
WMS-108 завершена: draft/posted, HTTP-команды и атомарное проведение.
Следующая задача: WMS-109, PostgreSQL outbox worker; handler размещения — WMS-110.

Отчёты: [окружение WMS-101](reports/wms-101.md),
[тестовая инфраструктура WMS-102](reports/wms-102.md),
[транзакции и аудит WMS-103](reports/wms-103.md),
[складской baseline WMS-104](reports/wms-104.md),
[контракты WMS-105](reports/wms-105.md),
[outbox writer WMS-106](reports/wms-106.md),
[HTTP/idempotency WMS-107](reports/wms-107.md),
[приёмка WMS-108](reports/wms-108.md).

## 1. Приёмка + outbox + Docker

- Compose/PostgreSQL, Drizzle migrations, тесты на реальной БД.
- Минимальные catalog и warehouse fixtures, документ приёмки.
- Команда проведения: данные + остаток + movement + audit + event в одной транзакции.
- Локальный durable handler создаёт задание размещения без повторного начисления.
- Runtime JSON Schema validation, генерация типов, контрактные fixtures.
- Dockerfile API/worker, документированные команды.

Готово, когда rollback не оставляет следов, повтор HTTP не проводит документ второй раз,
два workers не дублируют эффект и сбой после claim восстанавливается.
Тесты доказывают порядок внутри агрегата и параллелизм разных агрегатов.
До готовности identity бизнес-endpoints доступны только в изолированном dev/test.

## 2. Складской сценарий и интерфейс

Identity и роли, размещение, конкурентные резервы, сборка, отгрузка,
компенсирующие операции. OpenAPI/client generation и простой web.
Готово, когда весь путь воспроизводим и негативные сценарии проверены,
в том числе резерв последней единицы, отмена и частичные операции.

## 3. Kubernetes

kind, Helm, Gateway API/Nginx, deployments, probes, graceful shutdown,
migration Job, Secret/configuration. Готово, когда кластер поднимается по README,
обновление и рестарт не теряют подтверждённые операции.

## 4. Наблюдаемость и нагрузка

OTel, Pino, Prometheus/Grafana, Loki/Tempo, k6.
Готово, когда виден путь команды до обработчика, есть alert на dead/backlog,
измерены baseline и ограничения стенда.

## 5. Kafka

Strimzi, publisher, consumer groups, AsyncAPI/Registry compatibility spike,
схемы и retry/quarantine, сохранение idempotency и порядка.
Готово после тестов broker outage, lost ack, rebalance и cutover по runbook.
Первый publisher singleton; HA — отдельная задача с fencing и fault tests.

## 6. Поставка

GitHub Actions/GHCR при подтверждённом хостинге, Argo CD,
автоматические gates, image scan, секреты и rollback drill.
Готово, когда выпуск воспроизводим и восстановление проверено.

## Стиль реализации

По умолчанию controller → service → repository по [ADR-0009](adr/0009-nest-service-repository-default.md).
Сервисы, repositories и DTO размещаются в отдельных одноимённых каталогах.
WMS-103 audit приведён к этому стилю; складские задачи не начинаем в рамках рефакторинга.

## Формат задачи

Цель → сценарий → затронутые модули/контракты → инварианты → критерии приёмки →
проверки → миграции/эксплуатация → документация.
Инфраструктура не должна скрывать неготовность бизнес-инвариантов.
