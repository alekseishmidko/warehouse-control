# Проверка функционала перед PR

Перед каждым PR из корня выполнить:

```sh
pnpm check:pr
```

Команда останавливается на первом неуспешном шаге. Ненулевой exit code запрещает
считать проверку завершённой. После изменения поведения нужно повторить запуск
на итоговом diff. Указать команду и результат в описании PR.

## Предусловия и границы

Установить dependencies через `pnpm install --frozen-lockfile`. Нужны Node/pnpm
из package.json и работающий Docker-compatible daemon с доступным socket.
Для первой загрузки образов нужен доступ к registry. PostgreSQL/Testcontainers
должен запускаться локально. Dev Compose и рабочая .env для этих тестов не нужны.
Миграции применяются к отдельным disposable БД. Рабочие volume не очищаются.

Если Docker недоступен, integration падает. Skip, mock fallback, passWithNoTests и
forceExit не включены. Без успешного integration прогона проверка PR не пройдена.
Не запускать два test:prepare/check:pr одновременно в одном checkout.

Это локальная команда и обязательное правило review. Автоматического запуска при
создании PR, Git hook или обязательного CI status check пока нет. Эта задача не
настраивает внешний хостинг и не публикует проект. Команду можно использовать
будущим CI без изменения состава проверок.

## Что выполняется

```mermaid
flowchart TD
  A[pnpm check:pr] --> B[Prettier check без изменения файлов]
  B --> C[TypeScript source и tests typecheck]
  C --> D[Проверить generated event contracts]
  D --> E[Production build]
  E --> F[Проверить generated OpenAPI]
  F --> G[Очистить test output и скомпилировать tests]
  G --> H[Jest unit и integration последовательно]
  H --> I[PostgreSQL migrations, HTTP, ledger, locks, faults и worker processes]
  I --> J[Exit 0: проверка текущего diff пройдена]
  B -->|Ошибка| X[Exit nonzero: исправить и повторить]
  C -->|Ошибка| X
  D -->|Ошибка| X
  E -->|Ошибка| X
  F -->|Ошибка| X
  G -->|Ошибка| X
  H -->|Ошибка| X
```

Root check:pr вызывает backend test:pr. Тот использует существующий test:prepare
один раз, затем Jest --runInBand. Подготовка не дублируется двумя параллельными
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
DB locks и SQL fault injection. Unit-тесты в эту команду не входят. Она удобна во
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
