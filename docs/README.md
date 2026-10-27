# Документация Warehouse Controller

Это стартовый проектный baseline. Статус «принято» означает согласованное
архитектурное направление, а не готовую реализацию.

| Документ | Содержание |
|---|---|
| [Продукт для менеджеров](product.md) | Роли, процессы, критерии и ограничения |
| [Стандарт документации](documentation-standard.md) | Модули и каждый файл |
| [Shared и DRY](shared.md) | Повторное использование и границы общей логики |
| [Каталог файлов](file-catalog.md) | Назначение собственных файлов |
| [Шаблон модуля](templates/module.md) | Бизнес- и техническая документация |
| [Текущий backend](../apps/backend/README.md) | Реализованный корневой модуль |
| [Архитектура](architecture.md) | Модули, зависимости, процессы, целевой стек |
| [Минимальные складские данные](stock-baseline.md) | Модели, int4, начисление, dev fixtures и ограничения |
| [Домен](domain.md) | Сущности, операции и инварианты склада |
| [Контракты](contracts/README.md) | API, события, совместимость и ответственность |
| [Транзакции и аудит](transactions.md) | Реализованные ports, scope, маскирование, роли и retry policy |
| [Outbox](outbox.md) | Транзакции, доставка, идемпотентность и Kafka |
| [Эксплуатация](operations.md) | Docker, Kubernetes, наблюдаемость, CI/CD |
| [План](roadmap.md) | Этапы и критерии готовности |
| [Отчёт WMS-104](reports/wms-104.md) | Складские модели, гонки, ограничения и проверки |
| [Приёмка WMS-108](receiving.md) | HTTP-команды draft/posted, пример 10 штук и SQL proof |
| [Отчёт WMS-108](reports/wms-108.md) | Конкурентное проведение и rollback на каждом шаге |
| [Worker WMS-109](../apps/backend/src/infrastructure/worker/README.md) | Протокол, конфигурация, движение данных и ограничения |
| [Подробный флоу worker](flows/worker.md) | Графические схемы, пошаговые ветки, состояние БД и границы транзакций |
| [Putaway WMS-110](flows/putaway.md) | Подробный production flow, состояния, Mermaid и SQL receipt → event → task |
| [Отчёт WMS-110](reports/wms-110.md) | Tasks/marker atomicity, SQL constraints, duplicate/concurrency и SIGKILL evidence |
| [Отчёт WMS-109](reports/wms-109.md) | Реальные PostgreSQL races/faults и child-process shutdown/crash |
| [Отчёт WMS-107](reports/wms-107.md) | HTTP foundation, OpenAPI и транзакционная идемпотентность |
| [Отчёт WMS-106](reports/wms-106.md) | Атомарная запись outbox, counter races, migrations и retention |
| [Отчёт WMS-105](reports/wms-105.md) | Runtime contracts, generation, fixtures и пределы сообщений |
| [Отчёт WMS-103](reports/wms-103.md) | Атомарность audit, scopes, права и результаты проверок |
| [Отчёт WMS-102](reports/wms-102.md) | Jest, Supertest, изоляция БД и проверки cleanup |
| [Отчёт WMS-101](reports/wms-101.md) | Проверенное окружение, миграции и результаты проверок |
| [План разработки](development-plan.md) | 38 задач и 217 подробных шагов с зависимостями, проверками и демонстрациями |
| [ADR](adr/README.md) | Принятые решения и шаблон новых решений |
| [Восстановление обработки](runbooks/event-recovery.md) | Зависшие, ошибочные и повторные события |
| [Контекст агента](../AGENTS.md) | Ограничения и правила работы с проектом |

## Подход к коду

По умолчанию NestJS controller → service → repository; более сложную структуру
вводим при необходимости. Audit уже переведён на сервис и repository,
транзакции/маскирование/права сохраняются. Сервисы, repositories и DTO
размещаются в services/, repositories/ и dto/. README модулей включает схему
взаимодействия и подробное движение данных с примерами. См. [ADR-0009](adr/0009-nest-service-repository-default.md).

## Фактический статус

- Готово: pnpm workspace, NestJS backend, TypeScript, build/typecheck,
  `GET /` и `GET /health`.
- Готово WMS-101: Compose PostgreSQL, Drizzle/pg, baseline migration, runtime config,
  startup/shutdown pool и baseline smoke.
- Готово WMS-102: Jest unit/integration, Supertest, PostgreSQL Testcontainers,
  реальные migrations и cleanup при ошибке; config tests перенесены в Jest.
- Готово WMS-103: transaction port/context, PostgreSQL runner, AuditService/AuditRepository,
  redaction и migrations с append-only trigger/runtime grants.
- Готово WMS-104: минимальные catalog/warehouses/inventory, начисление в общем context,
  immutable movement/audit, int4 quantity и dev-only fixtures CLI.
- Готово WMS-105: Ajv 2020-12/formats, code registry, producer/handler validation
  entrypoints, TS/schema generation и diff gate, контрактные fixtures и limits.
- Готово WMS-106: PostgreSQL outbox writer, транзакционные aggregate counters, pending
  deliveries/streams, immutable envelope и retention guards. Worker protocol добавлен WMS-109.
- Готово WMS-107: prefix/validation/problem responses/correlationId, isolated dev actor,
  command idempotency storage и OpenAPI generation/diff.
- Готово WMS-108: receiving draft/posted, три business routes под isolated dev actor,
  атомарные stock/movement/audit/outbox/HTTP result и concurrency/fault tests.
- Готово WMS-109: отдельный worker, SKIP LOCKED/token/lease, markers/cursors,
  retry/dead и bounded SIGTERM. Production handler подключён WMS-110.
- Готово WMS-110: durable inventory.putaway, pending task на source line, task audit,
  atomic marker/cursors/completion и crash/duplicate tests без повторного stock credit.
- Описано, но не реализовано: физическое размещение и остальные складские операции,
  production авторизация, frontend, Docker image backend, Kubernetes и CI/CD.
- Пример контракта `ReceivingPosted` — проектный образец, не опубликованный API.
- Локальные schema/fixtures/generation проверки выполняются в unit suite;
  OpenAPI generation/diff готов локально; CI workflow и breaking-change comparison пока не настроены.

## Порядок чтения

Архитектура → домен → контракты → outbox → ADR → roadmap.
При расхождении документов с кодом фиксировать расхождение явно; не выдавать
целевую схему за существующую функциональность.

## Открытые вопросы

- Правила частичной отгрузки и истечения резерва: до реализации fulfillment.
- Выбор системы авторизации: до identity; локальные сессии — исходное предложение.
- Точная версия и режим Schema Registry: перед Kafka, после compatibility spike.
- Ресурсы локального кластера и место внешнего стенда: перед Kubernetes.
- Резервное копирование и численные SLO: до эксплуатации внешнего стенда.
