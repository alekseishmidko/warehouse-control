# Этапы реализации

Не начинать следующий инфраструктурный этап до рабочего вертикального сценария.
Этап 1 завершён: WMS-101–WMS-112 выполнены; Docker gate 1 и существующие
unit/integration gates пройдены, ограничения перечислены в отчёте WMS-112.

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
WMS-109 завершена: worker protocol, lease fencing, atomic markers/cursors, retry/dead и SIGTERM.
WMS-110 завершена: production handler создаёт pending task и audit атомарно с marker/cursors/ack.
WMS-111 завершена: local inspect/retry/signal, operator/reason history и verified runbook.
WMS-112 завершена: один multi-stage non-root image, Compose API/worker/migrate,
чистая сборка и Docker gate 1.
WMS-201 завершена как согласование бизнес-правил: B1–B4 приняты владельцем продукта
2026-10-29; подготовлены переходы, числовые AC и проект контрактов. Следующая задача —
WMS-202 (identity/ACL). В WMS-202 приняты способ auth (логин/пароль + серверная сессия)
и threat assumptions, затем матрица ролей/складов: WMS-202.1 завершена.
WMS-202 реализована и проверена; числовых defaults сессий нет, оба срока задаются явно.
WMS-203 реализована: полное размещение из receiving в storage, парные movements, audit/outbox
и идемпотентный API с warehouse policy. WMS-204 выполнена: заказ и резервирование. Следующая задача — WMS-205: сборка.
[ADR-0018](adr/0018-server-sessions.md), [ADR-0019](adr/0019-warehouse-role-matrix.md),
[identity](identity.md).
Picking/shipping и дополнительные проектные детали ещё не реализованы; auth/ACL готовы WMS-202.

Отчёты: [окружение WMS-101](reports/wms-101.md),
[тестовая инфраструктура WMS-102](reports/wms-102.md),
[транзакции и аудит WMS-103](reports/wms-103.md),
[складской baseline WMS-104](reports/wms-104.md),
[контракты WMS-105](reports/wms-105.md),
[outbox writer WMS-106](reports/wms-106.md),
[HTTP/idempotency WMS-107](reports/wms-107.md),
[приёмка WMS-108](reports/wms-108.md),
[worker WMS-109](reports/wms-109.md),
[durable handler WMS-110](reports/wms-110.md),
[administrative recovery WMS-111](reports/wms-111.md),
[Docker gate WMS-112](reports/wms-112.md).

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

[Правила WMS-201](fulfillment-rules.md) фиксируют принятые B1–B4 и проект переходов.
[Flow/AC](flows/fulfillment.md) и [контракты](contracts/fulfillment.md) — основа будущей
реализации; дополнительные технические детали не утверждаются этим статусом.
Заказ, резерв и release/cancel реализованы WMS-204; picking/shipping ещё не реализованы.

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

WMS-202: внутри IdentityModule выполнено разделение AuthService/SessionsService/UsersService/
AccessService, с сохранением общего context, HTTP контрактов и SQL schema. Подробный flow и
проверки межсервисного rollback — [identity flow](flows/identity.md), [отчёт](reports/wms-202.md).

WMS-202: добавлены controller/auth/HTTP boundary tests и integration cases для адресного
отзыва, удаления роли, logout SQL fault и всей warehouse action matrix. Coverage gate
IdentityController — 100%, команда `pnpm test:identity:coverage`; следующий этап после WMS-203 — WMS-204.

WMS-203 завершена: [flow](flows/putaway-execution.md), [отчёт](reports/wms-203.md),
[ADR-0021](adr/0021-putaway-execution.md). Source/target balances блокируются и создаются
в стабильном порядке, pair/task/audit/event/result атомарны. Произвольное движение allocation,
межскладской transfer, partial/cancel ещё не реализованы. Далее WMS-204.

WMS-204 реализована: orders/lines, explicit reserve, partial release/cancel, ledger reconciliation и API.
[Подробный flow](flows/reservations.md), [отчёт](reports/wms-204.md); далее WMS-205.

Готово WMS-204: [orders/reservations flow](flows/reservations.md), [проверки](reports/wms-204.md).
Заказ draft→active, явный атомарный reserve, release и отмена до сборки; expiry исключён B4.

P2 WMS-204 reconciliation исправлен новой migration 0025: INSERT/UPDATE всех balances,
предварительная сверка без автоматического исправления истории; negative PostgreSQL cases.

Исправления review: concurrent logout сериализуется через session UPDATE до valid check;
устаревшие ACL/worker/placement/registry README актуализированы. Стандарт будущих проверок —
[code-review](code-review.md). Следующая бизнес-задача остаётся WMS-205.

Identity: собственные admin-операции получают user UPDATE до session lock. Это исправление
гонки с аутентификацией; HTTP-контракты, матрица ролей и следующий этап WMS-205 не изменены.
[Порядок блокировок и evidence](flows/identity.md#собственные-административные-операции).
