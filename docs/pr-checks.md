# Проверка функционала перед PR

Перед каждым PR из корня выполнить:

```sh
pnpm check:pr
```

Команда останавливается на первом неуспешном шаге. Ненулевой exit code запрещает
считать проверку завершённой. После изменения поведения нужно повторить запуск
на итоговом diff. Указать команду и результат в описании PR.

## Ревью до итогового прогона

Каждое завершённое изменение интерфейса, бизнес-требований или фичи запускает
обязательное ревью исполнителем без отдельного запроса. Исправления проходят
повторное ревью и проверки функционала. Полный порядок и критерии —
[требования к код-ревью](code-review.md#обязательное-ревью-после-изменения-функционала).
В PR зафиксировать результат этого цикла. `check:pr` проверяет код командами,
но не заменяет смысловую проверку реализации и требований.

## Предусловия и границы

Установить dependencies через `pnpm install --frozen-lockfile`. Нужны Node/pnpm
из package.json и работающий Docker-compatible daemon с доступным socket.
Node: ^22.22.2, ^24.15.0 либо >=26 (в том числе требования jsdom).
До первого прогона установить браузер: `pnpm exec playwright install chromium`.
В Linux могут понадобиться системные зависимости Playwright; их установка — часть
подготовки машины, не автоматический skip теста. Для первой загрузки образов нужен доступ к registry. PostgreSQL/Testcontainers
должен запускаться локально. Dev Compose и рабочая .env для этих тестов не нужны.
Миграции применяются к отдельным disposable БД. Рабочие volume не очищаются.

Если Docker недоступен, integration падает. Skip, mock fallback, passWithNoTests и
forceExit не включены. Без успешного integration прогона проверка PR не пройдена.
Не запускать два test:prepare/check:pr одновременно в одном checkout.
Перед check:pr остановить dev:all и отдельные backend watchers: они пишут тот же dist.

Это локальная команда и обязательное правило review. Автоматического запуска при
создании PR, Git hook или обязательного CI status check пока нет. Эта задача не
настраивает внешний хостинг и не публикует проект. Команду можно использовать
будущим CI без изменения состава проверок.

## Что выполняется

```mermaid
flowchart TD
  A[pnpm check:pr] --> B[Prettier check без изменения файлов]
  B --> L[Typed lint: Promise, any, TS comments]
  L --> R[Architecture graph, negative self-tests и dev process tests]
  R --> W[Проверить web API generation diff]
  W --> C[TypeScript backend/web и tests typecheck]
  C --> WB[Vite web build]
  WB --> WT[Vitest: transport / journal / components / workspace]
  WT --> WV[Web V8 coverage и per-file baseline]
  WV --> D[Проверить generated event contracts]
  D --> E[Production build]
  E --> F[Проверить generated OpenAPI]
  F --> G[Очистить test output и скомпилировать tests]
  G --> H[Jest unit и integration последовательно]
  H --> I[PostgreSQL migrations, HTTP, ledger, locks, faults и worker processes]
  I --> BG[Chromium gate 2: Vite → API → worker → PostgreSQL]
  BG --> V[Coverage собственного backend и baseline guard]
  V --> J[Exit 0: проверка текущего diff пройдена]
  L -->|Ошибка| X
  R -->|Ошибка| X
  V -->|Ошибка| X
  B -->|Ошибка| X[Exit nonzero: исправить и повторить]
  C -->|Ошибка| X
  D -->|Ошибка| X
  E -->|Ошибка| X
  F -->|Ошибка| X
  G -->|Ошибка| X
  H -->|Ошибка| X
  W -->|Ошибка| X
  WB -->|Ошибка| X
  WT -->|Ошибка| X
  WV -->|Ошибка| X
  BG -->|Ошибка| X
```

Root check:pr проверяет lint/архитектуру/self-tests, `test:dev` (env/порты, реальные
дочерние процессы, shutdown/deadline), web generation/typecheck/build/Vitest
и отдельный web baseline. Затем вызывает backend
test:pr → test:coverage: test:prepare один раз, Jest с jest.coverage.config.cjs
и --runInBand, затем проверка coverage baseline. Подготовка не дублируется двумя параллельными
командами. Последовательное исполнение уменьшает конкуренцию ресурсов тестового
стенда; явные конкурентные тесты внутри suites продолжают создавать реальные гонки.
Build/test output может перезаписываться; source/generated contracts не регенерируются
автоматически ради зелёного результата. Ошибку generation diff нужно исправить
штатным generator и проверить полученный diff.

## Быстрый функциональный прогон

```sh
pnpm test:functional
```

Это все integration suites, а не только последний изменённый модуль. Они используют
реальные PostgreSQL migrations, Nest HTTP/Supertest, worker/CLI child processes,
DB locks, SQL fault injection и Chromium web gate 2. Vitest и Jest unit в эту команду
не входят. Docker и Playwright Chromium обязательны. Она удобна во
время разработки, но не заменяет итоговый check:pr.

При изменении Dockerfile/Compose дополнительно выполнить docker:image-check и docker:gate.
Они не входят в обычный PR-прогон, так как проверяют упаковку, сборку image и отдельный
сквозной стенд. test:db-baseline перезапускает dev Compose и тоже не включён в check:pr.

## Как понимать результат

Зелёный прогон доказывает прохождение написанных сценариев в проверенном окружении.
Он не доказывает 100% покрытия ветвей, всех interleavings, реальных физических действий
оператора или внешнего deployment. Число tests не равно числу бизнес-требований.
Границы конкретного diff указывать через traceability таблицу, например
[WMS-206](reports/wms-206.md#соответствие-diff-документации-и-тестов).

Новых бизнес-сценариев нельзя считать проверенными только потому, что старые tests
прошли. Для изменения добавить проверки его наблюдаемых результатов, отказов,
конкуренции и rollback. Внешние/ручные проверки и неисполненные команды отметить отдельно.

[Политика качества и покрытия](quality.md). HTML/JSON coverage — apps/backend/coverage/backend
и apps/web/coverage. Browser coverage не объединяется с V8/Jest. Быстрые команды UI:
`pnpm test:web`, `pnpm test:web:gate`, `pnpm web:api:check`. [Web запуск](../apps/web/README.md).
Новые или пропавшие source записи и снижение метрик блокируют baseline guard.
