# Driver нагрузки

## Задача и граница доверия

Оператор измеряет приложение на синтетических данных и проверяет сохранность
складского ledger. Пользователь выбирает только имя сценария. Driver сам выбирает
UUID проекта, новую БД и loopback endpoint. Проверка не принимает SQL/URL/env от
оператора. Доступ к Docker daemon остаётся доверенной локальной capability.

## Взаимодействие и шаги

`run.cjs` владеет ресурсами и фазами. Он использует ограниченный Docker transport
из `scripts/docker-gate.cjs`; импорт transport не запускает прежний gate.
`config.cjs` задаёт единый публичный бюджет для driver/k6. `dataset.cjs` создаёт
данные production owners и выдаёт каждому VU настоящую отдельную session.
`observe.cjs` читает gauges PostgreSQL без query text/payload и ограничивает
параллелизм наблюдения. `reconcile.cjs` сверяет committed факты в read-only snapshot. `results.cjs`
проверяет полноту k6 iterations и отсутствие capabilities в success/failure artifacts.

Последовательность, SQL, Mermaid, ошибки, данные артефакта и cleanup описаны
один раз в [load flow](../../docs/flows/load-testing.md). Команды и k6 entrypoints —
в [load README](../../load/README.md).

## Ошибки и примеры

`pnpm load:sku` завершает четыре пересекающихся резерва: один ответ 200, три
409 `INSUFFICIENT_STOCK`. Три конфликта допустимы; иной код, второй allocation,
отрицательный остаток или зависшая delivery приводят к exit 1. Ошибка driver не
исправляет данные SQL. `finally` закрывает observer/pool и удаляет свой стенд.

## Проверки

`pnpm test:load` проверяет выбор сценария, отказ при каждом нарушении сверки,
границы ожидания, sample aggregation, ошибки observer и отмену generator.
`pnpm load:baseline` проверяет настоящий k6/HTTP/PostgreSQL, DB barrier, drain,
идемпотентный replay, инварианты и SIGTERM. Native tests включены в `check:pr`.
Реальные нагрузки оставлены отдельной явной командой: их время и ресурсы
нельзя совмещать с coverage и считать результат сопоставимым baseline.
