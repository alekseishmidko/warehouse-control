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
| [Домен](domain.md) | Сущности, операции и инварианты склада |
| [Контракты](contracts/README.md) | API, события, совместимость и ответственность |
| [Транзакции и аудит](transactions.md) | Реализованные ports, scope, маскирование, роли и retry policy |
| [Outbox](outbox.md) | Транзакции, доставка, идемпотентность и Kafka |
| [Эксплуатация](operations.md) | Docker, Kubernetes, наблюдаемость, CI/CD |
| [План](roadmap.md) | Этапы и критерии готовности |
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
- Описано, но не реализовано: складской домен WMS и outbox,
  обработчики, авторизация, frontend, Docker image backend, Kubernetes и CI/CD.
- Пример контракта `ReceivingPosted` — проектный образец, не опубликованный API.
- CI-проверка JSON Schema, OpenAPI и совместимости пока не настроена.

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
