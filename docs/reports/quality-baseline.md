# Поддерживаемость: внедрение правил и проверок

## Выполненные шаги

1. AGENTS.md сокращён с 562 до 147 строк. Удалены устаревшие версии stock/picking/
   shipping правил и «следующей задачи». Фактические правила ссылаются на владельцев;
   отчёты WMS сохранены, migrations и production бизнес-поведение не переписаны.
2. Введены шаблон изменения с AC ID и обязательная матрица AC → реализация → test title
   → результат. Критерии определяются до зависимого кода, неопределённое правило согласуется.
3. Введено измерение всего собственного backend: source maps TS, V8, HTML/JSON summary.
   Generated output исключён по происхождению, собственные schema/DTO/entrypoints остаются.
   IdentityController 100% threshold сохранён. Это не заявление о 100% всех модулей.
4. Regression policy закрепляет каждый поведенческий дефект тестом, по возможности
   показывает отказ до исправления. Ослабление тестов ради зелёного отчёта запрещено.
5. Установлены pinned ESLint/typescript-eslint. Typed lint проверяет Promise/any/TS comments.
   Architecture guard проверяет application imports/cycles, private repositories и shared.
   Отрицательные self-tests подтверждают, что guards действительно находят нарушения.
6. Закреплены независимость fixtures, отсутствие случайных ожиданий и проверка
   запрещённых эффектов. Новый AC-QUALITY-01 проверяет складской lifecycle после каждого commit.
7. Правила одной ответственности и понятных методов связаны с ревью; универсальные
   абстракции/флаги и произвольные лимиты строк не подменяют анализ ответственности.
8. Один владелец правила: AGENTS — навигация, quality — готовность/coverage,
   domain/contracts/flows — бизнес и сценарии, reports — исторические результаты.

## Требования и evidence

| AC ID         | Ожидаемое поведение                                                                       | Реализация                                                 | Проверка                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| AC-QUALITY-01 | reserve → pick 6 → ship 4 → cancel → return 2: stock 10 → 6, final reserved 0, consumed 4 | Текущие owners inventory/fulfillment, production APIs      | shipping.spec.ts :: AC-QUALITY-01, SQL reconciliation после каждого commit                                  |
| AC-QUALITY-02 | Типизированный lint отклоняет floating Promise, explicit any и ts-ignore                  | eslint.config.cjs                                          | scripts/quality/lint.test.cjs :: floating Promise, explicit any и ts-ignore блокируются                     |
| AC-QUALITY-03 | Shared/чужой private repository/type-only boundary и runtime cycle дают finding           | scripts/quality/architecture.cjs                           | architecture.test.cjs, два положительных/отрицательных сценария                                             |
| AC-QUALITY-04 | Падение coverage, потеря source или новый source без принятого baseline дают отказ        | scripts/quality/coverage.cjs                               | coverage.test.cjs :: ratchet принимает прежние/улучшенные метрики, отклоняет снижение и потерю файла        |
| AC-QUALITY-05 | Истёкший lease не позволяет reclaim строк, которые уже блокирует processor                | Прежний WorkerService; исправлена только test coordination | worker.spec.ts :: active processing row locks fence reclaim even after expiry and block only that aggregate |

## Ревью и исправления

Typed lint выявил два executable запуска через void без наружного rejection handler:
worker.ts и outbox-admin.ts. Внутренние catch уже существовали; добавлена последняя
safe catch граница с exitCode=1 без исходного error payload. Политики операций не менялись.

Первый полный coverage прогон не прошёл: 548 tests passed, 24 failed. Picking harness
не завершил startup за существующий timeout; worker test ожидал вход в processing после
lease 200ms. Зависший барьер повлиял на следующую проверку состояния. Эти результаты не
используются как baseline успешного gate.

Worker regression исправлен без увеличения таймаутов: test-only expiry записывается
из уже заблокировавшей строки processing транзакции; вход в барьер соревнуется с
завершением processing Promise. Ресурсы/Promise освобождаются в finally. Убран pg_sleep.
В случае раннего stale тест теперь падает явно. Runtime lease policy не ослаблена.

## Область и ограничения

Статический graph не исполняет вычисляемый dynamic import. Schema FK callbacks исключены
только из cycle graph, их boundaries и migration tests остаются. Typed lint не доказывает
бизнес-корректность, AC evidence проверяется человеком/агентом. Нет внешнего CI, auto-review
бота и автоматического доказательства полноты всех исторических требований.

Child CLI функционально проверяются существующими child-process integration tests;
их coverage не объединяется с parent Jest. Uncovered branches остаются в отчёте.
Отдельный mutation engine не устанавливался. Документация не выдаёт цель 100% за уже
достигнутый результат. Docker image/gate и рабочая БД не запускались/не менялись.

## Подтверждённое исходное покрытие

Повторный полный pnpm test:coverage: **572 tests / 37 suites**, exit 0, Jest 155.052 s.
V8: **lines/statements 90.45%, branches 94.35%, functions 90.06%**.
Успешный JSON summary стал исходной точкой docs/coverage-baseline.json: 196 source файлов.
Baseline охватывает каждый файл отдельно и не создаётся повторно автоматически.
Чисто типовые TS объявления могут не иметь исполняемых JS счётчиков; это не тест поведения.

Основные оставшиеся business branch gaps (фактический отчёт, не плановое покрытие):

| Source                                                        | Branch coverage |
| ------------------------------------------------------------- | --------------- |
| `src/modules/fulfillment/services/fulfillment.service.ts`     | 88%             |
| `src/modules/fulfillment/services/picking.service.ts`         | 86.44%          |
| `src/modules/fulfillment/services/shipping.service.ts`        | 88%             |
| `src/modules/identity/services/access.service.ts`             | 90.9%           |
| `src/modules/identity/services/auth.service.ts`               | 96.29%          |
| `src/modules/identity/services/sessions.service.ts`           | 96.15%          |
| `src/modules/identity/services/users.service.ts`              | 93.5%           |
| `src/modules/inventory/services/picking-stock.service.ts`     | 87.5%           |
| `src/modules/inventory/services/putaway-execution.service.ts` | 84.21%          |
| `src/modules/inventory/services/shipping-stock.service.ts`    | 87.5%           |
| `src/modules/receiving/services/receiving.service.ts`         | 91.66%          |
| `src/modules/warehouses/services/warehouses.service.ts`       | 90%             |

Часть этих ветвей требует новых сценариев отказа и ограничений; они не объявлены
проверенными этой задачей. Все четыре метрики по файлам сохранены в baseline JSON;
детали uncovered — в локальном HTML отчёте. Непокрытые entrypoint/child-process
ветки учитываются отдельно от их функциональных тестов.

## Итоговое ревью

Проверены изменённые конфигурации, typed lint, реальные resolver paths, boundaries,
обработка неверных coverage данных и негативные self-tests. В guard исправлена
возможность пропустить отсутствующую/нечисловую метрику через JS comparison.
Повторное ревью не выявило новых подтверждённых дефектов в изменённой области.

## Итоговая проверка перед PR

Полный `pnpm check:pr` завершился с **exit code 0** после исправлений и повторного ревью:

- Prettier, typed ESLint, application import graph и TypeScript source/tests — успешно.
- Шесть отрицательных/положительных self-tests инструментов качества — успешно.
- Event generation diff, production build и OpenAPI generation diff — успешно.
- Jest: **572 tests / 37 suites**, включая Docker/PostgreSQL и child-process сценарии;
  Jest 143.491 s. Skip/fallback/forceExit не использовались.
- Coverage: lines/statements **90.45%**, branches **94.35%**, functions **90.06%**.
- Per-file baseline: **196 source files, no regressions**.

Offline frozen-lockfile install проверен на существующем pnpm store; lockfile согласован
с закреплёнными dev dependencies. После записи результатов повторно проверены
форматирование документов, локальные ссылки, каталог новых файлов и git diff --check.
Полный прогон не повторялся ради записи результатов в документацию.
