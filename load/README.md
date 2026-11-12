# Нагрузка WMS-403

Из корня, с установленными dependencies и доступным локальным Docker:

```sh
pnpm load:throughput
pnpm load:sku
pnpm load:backlog
pnpm load:baseline
```

Каждая команда создаёт отдельную БД, пользователей, приложение и профиль WMS-402.
`baseline` выполняет три сценария последовательно на трёх чистых стендах.
Команды не принимают URL/DB credentials и не читают рабочую `.env`. Нужен доступ
к registry при первой сборке. Не запускать одновременно с другими load/gates:
нагрузка соседних процессов меняет результат. Для штатной остановки — Ctrl-C.

Mac должен оставаться активным весь прогон. Автоматический sleep/wake прерывал
Docker exec и истекал таймауты подготовленного dataset; такой результат не принят.
Можно временно запретить только idle sleep на время команды:

```sh
caffeinate -i pnpm load:baseline
```

После завершения команды assertion снимается. Ручной sleep и закрытие крышки
не подходят для нагрузки; после такой паузы создать новый чистый прогон.

`artifacts/load/<scenario>.json` — локальный результат. `baseline` дополнительно
атомарно обновляет [публичный baseline](../docs/reports/wms-403-baseline.json)
только после всех проверок и cleanup. Неуспешный прогон пишет `*-failed.json` и
возвращает exit 1; предыдущий принятый baseline остаётся на месте. Формат JSON
объяснён в [подробном flow](../docs/flows/load-testing.md).

| Файл               | Назначение                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `k6/common.js`     | Session/CSRF adapter, фиксированные tags, deterministic command key, thresholds, безопасный summary |
| `k6/throughput.js` | 10 приёмок/с, максимум 4 VU, 20 секунд, отдельные SKU/склады, create → post                         |
| `k6/sku.js`        | 4 VU × 1 резерв одной штуки, 1 успех + 3 бизнес-конфликта                                           |
| `k6/backlog.js`    | 4 VU × 25 приёмок при остановленном worker                                                          |

k6 закреплён tag+digest в [config](../scripts/load/config.cjs); локальная установка
binary и сторонние JS imports не нужны. `options` задаёт executor/бюджет, default
функция выполняет один бизнес-сценарий, `handleSummary` сохраняет агрегаты в файл.
Идентификаторы/секреты dataset в summary не передаются.

Runtime приложения не отправляет логи в Loki из транзакции: используется
[WMS-402 collector](../infra/observability/README.md). Складские правила и HTTP
contracts остаются у владельцев [приёмки](../docs/receiving.md),
[резерва](../docs/flows/reservations.md) и [worker](../docs/flows/worker.md).
