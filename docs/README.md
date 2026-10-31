# Документация Warehouse Controller

Это стартовый проектный baseline. Статус «принято» означает согласованное
архитектурное направление, а не готовую реализацию.

| Документ                                                              | Содержание                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Продукт для менеджеров](product.md)                                  | Роли, процессы, критерии и ограничения                                                   |
| [Требования к код-ревью](code-review.md)                              | Бизнес-инварианты, concurrency, evidence, tests, модульность и актуальность документации |
| [Стандарт документации](documentation-standard.md)                    | Модули и каждый файл                                                                     |
| [Shared и DRY](shared.md)                                             | Повторное использование и границы общей логики                                           |
| [Каталог файлов](file-catalog.md)                                     | Назначение собственных файлов                                                            |
| [Шаблон модуля](templates/module.md)                                  | Бизнес- и техническая документация                                                       |
| [Текущий backend](../apps/backend/README.md)                          | Реализованный корневой модуль                                                            |
| [Архитектура](architecture.md)                                        | Модули, зависимости, процессы, целевой стек                                              |
| [Поля и PostgreSQL-типы](database-types.md)                           | Обоснование типов, NULL/default, ключей и индексов; пояснения в schema-файлах            |
| [Минимальные складские данные](stock-baseline.md)                     | Модели, int4, начисление, dev fixtures и ограничения                                     |
| [Identity flow и проверки](flows/identity.md)                         | Session/CSRF/warehouse policies, locks/revoke, bootstrap и реальные тесты                |
| [Отчёт WMS-202](reports/wms-202.md)                                   | Проверенные auth, migration, Docker и форматирование                                     |
| [Identity WMS-202](identity.md)                                       | Реализованные sessions/ACL/CSRF/bootstrap; числовые сроки задаются явно, без defaults    |
| [Правила WMS-201](fulfillment-rules.md)                               | B1–B4 приняты; переходы и техническая модель для будущей реализации                      |
| [Будущий fulfillment flow](flows/fulfillment.md)                      | Mermaid, числовые AC и гонки; не реализовано                                             |
| [Проект контрактов fulfillment](contracts/fulfillment.md)             | Границы будущих команд и лимиты; не опубликовано                                         |
| [Домен](domain.md)                                                    | Сущности, операции и инварианты склада                                                   |
| [Контракты](contracts/README.md)                                      | API, события, совместимость и ответственность                                            |
| [Транзакции и аудит](transactions.md)                                 | Реализованные ports, scope, маскирование, роли и retry policy                            |
| [Outbox](outbox.md)                                                   | Транзакции, доставка, идемпотентность и Kafka                                            |
| [Эксплуатация](operations.md)                                         | Docker, Kubernetes, наблюдаемость, CI/CD                                                 |
| [План](roadmap.md)                                                    | Этапы и критерии готовности                                                              |
| [Отчёт WMS-104](reports/wms-104.md)                                   | Складские модели, гонки, ограничения и проверки                                          |
| [Приёмка WMS-108](receiving.md)                                       | HTTP-команды draft/posted, пример 10 штук и SQL proof                                    |
| [Отчёт WMS-108](reports/wms-108.md)                                   | Конкурентное проведение и rollback на каждом шаге                                        |
| [Worker WMS-109](../apps/backend/src/infrastructure/worker/README.md) | Протокол, конфигурация, движение данных и ограничения                                    |
| [Подробный флоу worker](flows/worker.md)                              | Графические схемы, пошаговые ветки, состояние БД и границы транзакций                    |
| [Putaway WMS-110](flows/putaway.md)                                   | Подробный production flow, состояния, Mermaid и SQL receipt → event → task               |
| [Recovery WMS-111](flows/outbox-recovery.md)                          | Локальные inspect/retry/signal, права, история и Mermaid flow                            |
| [Docker flow](flows/docker-gate.md)                                   | Multi-stage image, startup/migration, Compose gate и shutdown                            |
| [Отчёт WMS-112](reports/wms-112.md)                                   | Clean build/layers, Docker gate 1, SQL и SIGTERM evidence                                |
| [Отчёт WMS-111](reports/wms-111.md)                                   | Проверенный CLI runbook, atomic audit/history, role/lease/cursor tests                   |
| [Отчёт WMS-110](reports/wms-110.md)                                   | Tasks/marker atomicity, SQL constraints, duplicate/concurrency и SIGKILL evidence        |
| [Отчёт WMS-109](reports/wms-109.md)                                   | Реальные PostgreSQL races/faults и child-process shutdown/crash                          |
| [Отчёт WMS-107](reports/wms-107.md)                                   | HTTP foundation, OpenAPI и транзакционная идемпотентность                                |
| [Отчёт WMS-106](reports/wms-106.md)                                   | Атомарная запись outbox, counter races, migrations и retention                           |
| [Отчёт WMS-105](reports/wms-105.md)                                   | Runtime contracts, generation, fixtures и пределы сообщений                              |
| [Отчёт WMS-103](reports/wms-103.md)                                   | Атомарность audit, scopes, права и результаты проверок                                   |
| [Отчёт WMS-102](reports/wms-102.md)                                   | Jest, Supertest, изоляция БД и проверки cleanup                                          |
| [Отчёт WMS-101](reports/wms-101.md)                                   | Проверенное окружение, миграции и результаты проверок                                    |
| [План разработки](development-plan.md)                                | 38 задач и 217 подробных шагов с зависимостями, проверками и демонстрациями              |
| [ADR](adr/README.md)                                                  | Принятые решения и шаблон новых решений                                                  |
| [Восстановление обработки](runbooks/event-recovery.md)                | Зависшие, ошибочные и повторные события                                                  |
| [Контекст агента](../AGENTS.md)                                       | Ограничения и правила работы с проектом                                                  |

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
- Готово WMS-111: локальные inspect/retry/signal, безопасные key-value diagnostics,
  адресный retry с operator/reason/audit/history и сохранением общего attempts; проверенный runbook.
- Готово WMS-112: multi-stage non-root image API/worker/migrate, Compose startup gates,
  clean build/layers regression и реальная демонстрация gate 1 с SIGTERM/volume restart.
- Готово WMS-201 как согласование правил: B1–B4 приняты 2026-10-29, таблицы переходов,
  числовые AC и проект контрактов подготовлены. Заказы/резервы готовы WMS-204; сборка/отгрузка — следующие этапы.
- Готово WMS-202: users/sessions, login/logout/me, session/warehouse policies, admin API,
  one-time bootstrap и real PostgreSQL tests. Числовых defaults TTL нет; настройки обязательны явно.
  IdentityModule разделён на Auth/Sessions/Users/Access services с общим transaction context.
  Dev actor удалён; внешний TLS gateway/frontend ещё не реализованы.
- Готово WMS-203: task execution receiving → storage, pair movements, audit/outbox, idempotent API и locks.
- Описано, но не реализовано: сборка/отгрузка и остальные складские операции,
  frontend, Kubernetes и CI/CD.
- Пример контракта `ReceivingPosted` — проектный образец, не опубликованный API.
- Локальные schema/fixtures/generation проверки выполняются в unit suite;
  OpenAPI generation/diff готов локально; CI workflow и breaking-change comparison пока не настроены.

WMS-203: [подробный flow размещения](flows/putaway-execution.md),
[ADR-0021](adr/0021-putaway-execution.md), [отчёт](reports/wms-203.md).
Полное количество задания, только свободный stock, receiving → storage одного склада;
общий transfer/partial/cancel и consumers completion event в этот шаг не входят.

## Порядок чтения

Архитектура → домен → контракты → outbox → ADR → roadmap.
При расхождении документов с кодом фиксировать расхождение явно; не выдавать
целевую схему за существующую функциональность.

## Открытые вопросы

- Технические детали fulfillment: [правила WMS-201](fulfillment-rules.md); B1–B4 приняты,
  дополнительные меры при нехватке, schema/DTO и лимиты новых документов уточняются перед реализацией.
- Сроки сессий: [identity](identity.md); способ auth, threat assumptions и матрица
  ролей/складов приняты и реализованы WMS-202.
- Точная версия и режим Schema Registry: перед Kafka, после compatibility spike.
- Ресурсы локального кластера и место внешнего стенда: перед Kubernetes.
- Резервное копирование и численные SLO: до эксплуатации внешнего стенда.

## Чтение реализации WMS-111 и WMS-112

Русские комментарии к контрактам, транзакциям, SQL, тестовым сбоям и Docker-проверкам
дополняют флоу. Карты файлов: [восстановление outbox](flows/outbox-recovery.md#карта-реализации-и-чтение-кода-wms-111)
и [Docker](flows/docker-gate.md#карта-комментариев-wms-112). Пояснения к применённым
миграциям — в [Drizzle README](../apps/backend/drizzle/README.md#wms-111), без изменения SQL.

Identity HTTP transport дополнительно проверяется unit tests cookie/CSRF/commit boundaries
и real PostgreSQL tests revoke/role removal/logout faults/матрицы ADR-0019. Команда
`pnpm test:identity:coverage` требует Docker и контролирует 100% coverage IdentityController;
[подробности](../apps/backend/test/README.md#проверка-покрытия-identity).

WMS-204 реализована: orders/lines, explicit reserve, partial release/cancel, ledger reconciliation и API.
[Подробный flow](flows/reservations.md), [отчёт](reports/wms-204.md); далее WMS-205.

Готово WMS-204: [orders/reservations flow](flows/reservations.md), [проверки](reports/wms-204.md).
Заказ draft→active, явный атомарный reserve, release и отмена до сборки; expiry исключён B4.

P2 WMS-204 reconciliation исправлен новой migration 0025: INSERT/UPDATE всех balances,
предварительная сверка без автоматического исправления истории; negative PostgreSQL cases.

Замечания review остальных модулей исправлены: logout exclusive lock до проверки session,
permanent PostgreSQL race test, актуальные ACL/worker/receiving/registry README.
Требования к дальнейшим review — [code-review](code-review.md).

Identity: порядок блокировок собственных административных операций исправлен; проверка
валидности и продление сессии разделены. [Исполнение и регрессионные проверки](flows/identity.md#собственные-административные-операции).
