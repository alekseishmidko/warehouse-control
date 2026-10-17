# Этапы реализации

Не начинать следующий инфраструктурный этап до рабочего вертикального сценария.
Этап 1 начат: WMS-101 и WMS-102 выполнены; остальные задачи пока не реализованы.

Подробный backlog с ID задач, зависимостями, демонстрациями и критериями перехода:
[план разработки](development-plan.md): 38 задач, разбитых на 217 шагов с чекбоксами.
Этот roadmap остаётся обзором этапов;
статусы детальных задач ведутся в плане без дублирования их описаний здесь.

## 0. Baseline — документация подготовлена

Каркас NestJS и pnpm существует. Архитектура, контракты, ADR и контекст агента описаны.
PostgreSQL/Drizzle, первая миграция и Compose реализованы в WMS-101.
WMS-102 завершена: Jest/Supertest и PostgreSQL Testcontainers harness.
Следующая задача: WMS-103, transaction context и audit.

Отчёты: [окружение WMS-101](reports/wms-101.md),
[тестовая инфраструктура WMS-102](reports/wms-102.md).

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

## Формат задачи

Цель → сценарий → затронутые модули/контракты → инварианты → критерии приёмки →
проверки → миграции/эксплуатация → документация.
Инфраструктура не должна скрывать неготовность бизнес-инвариантов.
