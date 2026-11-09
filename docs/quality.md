# Качество изменения: требования, читаемость и доказательства

Владелец правил готовности и покрытия. AGENTS.md ссылается сюда; детали ревью —
в [code-review](code-review.md), запуск — в [pr-checks](pr-checks.md).

## Требования до реализации

Исполнитель заполняет [шаблон изменения](templates/change.md). Вход, участник,
доверие, права, результат, ошибки и инварианты определяются до зависимого кода.
Неясное бизнес-решение согласует владелец продукта. Технические детали исполнитель
выбирает в согласованном объёме. Критерии AC имеют стабильные ID и проверяемые результаты.

В отчёте каждый AC связан с методом реализации, файлом/названием теста и фактическим
результатом. Это проверка требований, не количество тестов. Изменение AC требует
сверки существующих tests/contracts; нельзя автоматически менять ожидания теста
под новую реализацию без принятого изменения смысла. Исторические этапы не объявляются
задним числом полностью трассированными: матрицы добавляются при их изменении.

## Читаемость и простота

Функция имеет одну понятную ответственность. HTTP parsing, бизнес-решение и SQL
не смешиваются. Длинное имя допустимо, если объясняет действие. Набор флагов для
независимых бизнес-операций — повод разделить методы. Лимит строк функции сам по себе
не доказывает качество. Абстракция решает реальную повторяющуюся задачу; shared
не становится владельцем бизнес-правила. [DRY](shared.md).

Strict TypeScript сохраняется. Explicit any и ts-ignore/ts-nocheck запрещены.
Внешний input имеет тип unknown с runtime narrowing. Cast не заменяет проверку,
особенно для DB/raw JSON. ts-expect-error допускается только с содержательной причиной;
lint-disable требует конкретного обоснования при ревью. Unused disables — ошибка.
Promise await/return/catch обязательны; void сам по себе не обрабатывает rejection.

## Автоматические проверки

`pnpm test:postgres:readiness` входит в check:pr и docker:gate: настоящий Compose
с новым volume/initdb barrier не должен считать Unix socket готовностью TCP.
Без Docker проверка падает; skip/fallback не предусмотрены.

| Команда                           | Что реально проверяется                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm lint                         | Typed ESLint backend/web/tests, Solid rules, запрет backend/React imports в web, any/Promises/TS suppressions                                                                      |
| pnpm check:architecture           | Статические TS/TSX imports/exports/литеральные require/import: shared, private repositories, web/backend boundaries, runtime cycles                                                |
| pnpm test:kubernetes:observations | Regression Kubernetes status: быстрая migration attempt и завершённая API revision перед auth; результат проверяет настоящий kind gate                                             |
| pnpm test:dependencies            | Проверка реальных consumers vendor patch deepmerge, archiver glob и esbuild CORS; входит в check:pr. Полный registry audit отдельно, ограничения — [patches](../patches/README.md) |
| pnpm test:quality                 | Отрицательные self-tests guards и настоящих lint rules                                                                                                                             |
| pnpm test:dev                     | Env/порты и lifecycle dev:all на настоящих child processes: SIGTERM, crash, deadline и ошибка drain                                                                                |
| pnpm test:coverage                | Все Jest suites с Docker, build/generation; покрытие всех собственных dist JS файлов                                                                                               |
| pnpm test:web                     | Vitest/jsdom и V8 всех собственных web TS/TSX, критические пороги и отдельный baseline                                                                                             |
| pnpm test:web:gate                | Chromium + Vite proxy + настоящие API/worker/PostgreSQL; Docker и установленный Chromium                                                                                           |
| pnpm check:pr                     | Полная цепочка выше, format/typecheck/contracts/OpenAPI и tests/coverage                                                                                                           |

ESLint 10.14.0 и typescript-eslint 8.72.1 закреплены в lockfile. Root TypeScript 5.9.3 закрепляет compiler peers lint на той же версии, что приложения. Typed parser использует
backend tsconfig/source/tests и web tsconfig. Solid lint 0.18.1 проверяет реактивный JSX.
Node: ^22.22.2, ^24.15.0 либо >=26; нижняя граница учитывает jsdom 30.1.3.
Docker runtime Node 24 совместим.
Настройка по [ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files)
и [typed linting](https://typescript-eslint.io/getting-started/typed-linting/).

Architecture guard не исполняет код и не анализирует произвольную вычисляемую загрузку.
Backend schema FK callbacks создают допустимые взаимные ссылки, поэтому backend *.schema.ts
и агрегатор schema.ts исключены только из runtime cycle graph. Web это исключение не получает.
Их boundaries продолжают проверяться;
DDL проверяют реальные migrations. Dynamic/computed imports требуют ручного ревью.
Это не полное доказательство отсутствия всех runtime циклов. Межмодульная SQL запись
и качество декомпозиции по-прежнему проверяются ревью и интеграционными тестами.

## Как исполняются guards

```mermaid
flowchart LR
  F[src TS files и tsconfig] --> P[TypeScript AST и resolver]
  P --> B[Проверка boundaries всех статических связей]
  P --> R[Runtime edges без type-only и schema FK]
  R --> C[DFS: поиск активного узла в стеке]
  B --> O[Exit 0 либо findings и exit 1]
  C --> O
  S[JSON summary успешного Jest] --> N[Пути относительно backend и четыре метрики]
  N --> V[Проверка значений 0..100 и полного набора source]
  A[Принятый coverage baseline] --> V
  V --> Q[По каждому файлу: current не ниже baseline]
  Q --> O
```

Пример запрещённой связи: `shared/a.ts → modules/inventory/services/inventory.service.ts`.
Architecture guard возвращает `shared boundary: ...` и exit 1. Локальный импорт своего
repository разрешён; чужого — finding даже для type-only связи. Type-only edges не
участвуют в runtime DFS. Проверка читает только source/config, не подключается к БД.

Coverage guard читает coverage-summary.json и baseline, нормализует абсолютные пути,
сравнивает lines/statements/functions/branches. Пример: baseline branches=90, current=89
даёт отказ; отсутствие метрики тоже отказ, а не успешное сравнение с undefined.
Guard не меняет baseline или HTML. Test fixtures создаются/удаляются в temp directories,
не в production source; cleanup выполняется в finally.

## Политика покрытия

1. Цель — evidence для 100% принятых AC, включая ошибки и запрещённые эффекты.
2. Для критических бизнес-правил цель — 100% branch coverage вместе с SQL/integration
   проверками. Число строк и coverage не доказывают все interleavings.
3. Jest измеряет все собственные backend файлы через collectCoverageFrom, в том числе
   неисполненные. Исключён только generated output; source схемы/DTO/entrypoints остаются.
4. Порог IdentityController 100% statements/branches/functions/lines сохранён.
   Остальные gaps публикуются по файлам. Нельзя утверждать, что всем модулям уже
   установлен или достигнут порог 100%. Повышение gates опирается на фактический baseline.
5. Coverage guard сравнивает каждый файл с docs/coverage-baseline.json. Снижение любой
   метрики, пропавший или новый source без принятого baseline дают отказ. Baseline создаётся
   только после успешного полного прогона и не перезаписывается автоматически.
6. Нельзя уменьшать охват файлов/порог, скрывать uncovered или отключать integration
   ради зелёного отчёта. Изменение baseline/исключения требует причины и ревью.
7. HTML и JSON summary: apps/backend/coverage/backend, Git ignored. Каждый отчёт
   указывает область/provider/ветви и пробелы. Child-process CLI coverage не объединяется
   с родительским Jest: CLI могут быть функционально проверены при неполном coverage отчёте.

Всеобщее 100% code coverage не является достигнутым результатом этой задачи. Недостающие
ветви нужно закрывать meaningful tests по риску. Не тестировать декораторы/generated
построчно ради цифры. Проверка качества тестов для критического правила: преднамеренное
удаление защиты должно привести к отказу соответствующего теста. Такой mutation probe
выполняется изолированно, изменение обязательно отменяется; отдельный mutation engine не установлен.

Исходная точка после успешного полного прогона: 196 source файлов, lines 90.45%,
branches 94.35%, functions 90.06%. [Фактические gaps и результаты](reports/quality-baseline.md).
JSON baseline — принятая исходная точка, не команда автоматического обновления при failure.
Для intentional изменения файла reviewer сверяет AC/tests и причину baseline diff;
новое бизнес-правило по-прежнему имеет цель 100% ветвей. Baseline не разрешает оставлять
новый сценарий непроверенным из-за низкого прежнего процента.

### Web и актуальный baseline WMS-208

Vitest/V8 включает все собственные src TS/TSX, в том числе неисполненные main/pages;
исключён только generated API output. Отдельный docs/web-coverage-baseline.json
фиксирует 22 файла. Текущее измерение: lines 62%, statements 57.71%,
branches 71.78%, functions 52.65%.
Это исходное измерение, не утверждение о полном покрытии UI. Browser gate исполняет
экраны в Chromium, но его coverage не смешивается с unit V8. JSX callbacks создают
отдельные функции; часть page/main callbacks не вызывается в jsdom. Их gaps видны в HTML.

ApiClient имеет пороги lines 95/statements 90/branches 90/functions 90. CommandJournal —
95/95/95/100. Полный web baseline сравнивается тем же ratchet через `--web`; снижение
любого файла или новый файл без рассмотренного baseline блокирует pnpm test:web.
Baseline не обновляется этой командой.

Backend после WMS-208: 201 файл, lines/statements 90.52%, branches 94.49%, functions
89.76%. Добавлены полностью проверенные read controller/decorator и три DTO.
OpenAPI decorator callbacks DTO выполняются offline generator, не runtime suite,
поэтому DTO functions=0 явно сохранены в baseline. Покрытие существующих файлов не
снижено; baseline пересмотрен только для изменённых/new source после успешных 576 tests.
Пять новых source имеют принятые entries, остальные baseline не ослаблены.
[Точная traceability, review и gaps](reports/wms-208.md).

## Регрессии и независимость тестов

Каждый поведенческий дефект получает regression test. По возможности зафиксировать
отказ на старом коде до исправления. Тест проверяет контракт, не внутренний порядок
вызовов. Для ошибки проверять отсутствие business/movement/audit/outbox эффектов и
освобождение ресурсов. Mocks уместны для изоляции внешней границы, но не заменяют SQL
locks, migration guards, atomicity или реальные политики доступа.

Тест не зависит от порядка, общих изменяемых данных или случайного sleep. Время и UUID
в сценариях должны иметь контролируемые источники или проверяться по инвариантам, а не
угаданным значениям. Fault injection и barriers документируются. Синтетические fixtures
вызывают владельцев, не копируют reserve/pick/ship расчёты. Сравнивать независимые стороны
учёта: баланс с ledger, task с marker, effects с movements.

Сквозной AC-QUALITY-01 закреплён в shipping.spec.ts: reserve → partial pick → partial ship
→ cancel → return. После каждого commit проверяются reserved=SUM(active), allocation
identity, onHand и consumed. Это постоянный integration test, не новый production сценарий.

## Обязательный процесс

```mermaid
flowchart TD
  A[Принятые AC с ID] --> B[Код, контракты, тесты и документация]
  B --> C[Ревью требований, diff и связанных сценариев]
  C --> D{Есть дефекты?}
  D -->|Да| E[Regression test и исправление]
  E --> C
  D -->|Нет| F[Lint, архитектура, build, tests и coverage]
  F --> G{Проверки успешны?}
  G -->|Нет| E
  G -->|Да| H[AC → реализация → evidence, gaps и ограничения]
```

Если новая бизнес-неопределённость мешает исправлению, согласовать её; не замыкать цикл
на придуманном правиле. Одна актуальная версия описания находится у владельца правила.
Правка статуса заменяет устаревшее утверждение, а не добавляет противоположное в конец.
[Отчёт внедрения](reports/quality-baseline.md).
