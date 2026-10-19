# Контекст и правила для агента

## Назначение

Warehouse Controller — учебная WMS: приёмка, размещение, резервирование,
сборка, отгрузка. Цель — практика транзакций, событий, конкурентного доступа,
наблюдаемости и эксплуатации в Kubernetes. Рабочий язык документации — русский,
идентификаторов и кода — английский.

## Сначала прочитать

1. `docs/README.md` — карта документации и статус проекта.
2. `docs/architecture.md` — границы модулей и потоки данных.
3. `docs/domain.md` — бизнес-инварианты.
4. `docs/contracts/README.md` — правила API и событий.
5. Принятые ADR в `docs/adr/` и текущий этап в `docs/roadmap.md`.

## Текущее состояние

Реализованы каркас NestJS (`GET /`, `GET /health`) и WMS-101: Compose PostgreSQL,
Drizzle/pg, baseline migration, runtime config и управление pool.
Есть pnpm workspace, build/typecheck и WMS-102: Jest unit/integration,
Supertest, изолированный PostgreSQL Testcontainers и cleanup fixtures/resources.
WMS-103 реализована: shared transaction port/context, PostgreSQL runner и audit module
с redaction и append-only migrations. WMS-104: минимальные catalog/warehouses/inventory,
int4 quantity, guarded receipt, immutable movement и dev fixtures CLI.
Документы приёмки, frontend, outbox, Kafka, образ backend и Kubernetes ещё не реализованы.
Не считать наличие документации доказательством реализации.

## Обязательные ограничения

- Сохранять модульный монолит. API и worker — отдельные процессы одного backend.
- Сначала transactional outbox на PostgreSQL, затем Kafka. Outbox сохраняется.
- Остатки и резервы изменяет только `inventory` внутри транзакции.
- Бизнес-изменения, движения, аудит и outbox фиксируются атомарно.
- Доставка at least once; обработчики обязаны быть идемпотентными.
- Нельзя заменять надёжную доставку только EventEmitter или fire-and-forget.
- Не обещать exactly once, глобальный порядок событий или атомарность БД + Kafka.
- Не добавлять Redis/BullMQ, микросервисы или Event Sourcing без нового ADR.
- Не переносить ORM-модели и backend-классы в публичные контракты.
- Внешние побочные эффекты не выполнять внутри транзакции БД.
- Не редактировать уже применённые миграции; создавать новые.
- Не сохранять секреты, токены или реальные персональные данные в репозитории.

## Работа с изменениями

Менять только необходимое для текущей задачи. Не реализовывать весь roadmap
за один шаг. Для изменения архитектурного решения добавить ADR, связать
заменяющий ADR с предыдущим, обновить связанные документы.
Согласование документов не означает разрешение публиковать или разворачивать
проект во внешнем окружении.

При изменении API/событий обновлять схему, примеры и проверку совместимости.
При изменении поведения обновлять документацию вместе с кодом.
По умолчанию controller → service → repository, см. ADR-0009.
Controller отвечает за HTTP, service за сценарии/правила, repository за SQL/ORM.
Внутри модуля сервисы лежат в services/, репозитории в repositories/, DTO в dto/,
даже если файл пока один. Каталоги создаются с первым соответствующим файлом.
Модули экспортируют сервисы, repository остаётся внутренним provider;
прямые записи в чужие таблицы запрещены.
Не создавать обязательные domain/application/infrastructure/presentation слои
и отдельные interfaces/tokens для каждого класса. При необходимости выделять
сценарии, domain или ports локально с объяснением в README; значимые изменения — через ADR.

## Проверки

Существующие команды: `pnpm typecheck`, `pnpm build`.
`pnpm dev` запускает backend, `pnpm start` — собранный backend.
Jest: `pnpm test:unit` без Docker, `pnpm test:integration` с Testcontainers,
`pnpm test` — оба проекта; перед запуском production build и компиляция tests.
`pnpm test:config` — alias unit. Отдельный native `pnpm test:db-baseline`
перезапускает dev Compose postgres и не входит в Jest.
При недоступном Docker integration падает с ненулевым кодом, skip/fallback запрещены.
Test support — `apps/backend/test/support/`; отдельный контейнер на suite,
реальные migrations, config override через DI без изменения process.env.
Не запускать два test:prepare одновременно в одном checkout; suites одного Jest
прогона работают параллельно и имеют независимые БД.
Контрактные проверки ещё не настроены. Следующая задача — WMS-105.
При добавлении функциональности нужны проверки её бизнес-инвариантов.
Для outbox обязательны реальные PostgreSQL integration tests: rollback,
повторная доставка, конкуренция workers, восстановление после сбоя.
Не подменять их только моками. Отдельно сообщать, какие проверки не удалось выполнить.

## Завершение задачи

Указать, что изменилось, что проверено, какие ограничения остались.
Поддерживать фактический статус в `docs/README.md` и `docs/roadmap.md`.

## Документация и DRY — обязательные правила

Читать `docs/documentation-standard.md` и `docs/shared.md` перед изменениями.
Каждый backend-модуль, включая будущие shared/infrastructure, имеет README
по `docs/templates/module.md`: бизнес-раздел для менеджера и технический для разработчика.
README каждого модуля содержит схему взаимодействия и пошаговое движение данных:
вход/DTO, проверки и преобразования, вызовы сервисов/repositories, SQL/события,
результат, границы commit/rollback и ошибки. Добавлять синтетический пример
входа/выхода и ссылки на подтверждающие тесты; будущее отделять от реализованного.
Каждый исходный файл имеет file-level TSDoc/JSDoc; публичные символы — контракт,
ошибки и эффекты. Файлы без поддержки комментариев описывать в ближайшем README
и `docs/file-catalog.md`. Каждый новый собственный файл добавлять в каталог.
Generated artifacts описывать через генератор, не редактировать вручную.
Обновлять документацию одновременно с поведением; не оставлять TODO вместо неё.

Перед созданием утилиты искать существующий код через `rg`.
Переиспользуемую техническую логику выносить в `apps/backend/src/shared/<capability>/`;
код нескольких приложений — в packages при реальных потребителях.
Повтор бизнес-правила устранять через владельца домена, не переносом в shared.
Shared не импортирует модули или infrastructure. Адаптеры I/O — в infrastructure.
Не создавать utils-свалки, universal base service или абстракции только ради
похожего синтаксиса. При выделении общей логики проверять всех потребителей.

## Транзакции и аудит WMS-103

Сервис-владелец сценария вызывает TRANSACTION_RUNNER.run; вызываемые сервисы
получают тот же opaque TransactionContext. Infrastructure использует transactionClient.
Nested run, stale/cross-scope context запрещены. Все DB операции callback awaited;
fire-and-forget и внешнее I/O запрещены. Auto retry отсутствует, правила — docs/transactions.md.
Audit писать только через AuditService, с кодом основания и безопасными changes;
ошибка записи должна откатить сценарий. Runtime group warehouse_app имеет только
SELECT/INSERT audit; dev Compose по-прежнему admin, не production login.
Test cleanup вправе обходить trigger только внутри disposable harness БД.

## Складской baseline WMS-104

Количество: int4, MAX_STOCK_QUANTITY=2147483647. Приход 1..MAX, баланс 0..MAX,
0 <= reserved <= onHand. Проверки/schema/audit используют общий контракт.
Только InventoryService.receive изменяет stock, только в receiving location.
Guarded upsert, audit и immutable movement обязаны использовать один context.
OperationId уникален на одно движение: повтор отклоняется, HTTP dedup ещё нет.
Справочники вызываются через CatalogService/WarehousesService, не чужие repositories.
Dev fixtures: pnpm db:seed только development, новый набор без stock на каждый запуск.
Stock SQL/direct writes в tests допустимы только для проверки constraints;
cleanup отключает audit/movement triggers только в disposable container.
Draft event quantity уточнён до int4 до публикации. Runtime JSON Schema validation — WMS-105.
