# Приёмка WMS-108: запуск и проверка результата

Для менеджера: draft описывает фактически принятые товары, но не меняет остаток.
Проведение начисляет товар и оставляет движение, аудит и событие одной транзакцией.
Повтор не удваивает поступление. Пока реализован только локальный backend без UI,
production identity и фонового размещения. [Модель/ограничения и движение данных](../apps/backend/src/modules/receiving/README.md).

## Подготовка локального стенда

```sh
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

Seed выдаёт новые IDs товара, склада, receiving/storage/shipping, stock отсутствует.
В ignored `.env` для этого локального стенда явно задать NODE_ENV=development,
HTTP_HOST=127.0.0.1, DEV_ACTOR_ENABLED=true и синтетический DEV_ACTOR_ID UUID
(например dbb37b21-1c4a-4b32-9307-148df1647f4c). DATABASE_URL/PORT — как в .env.example.
Не запускать dev actor за proxy/на публичном bind; production включение отклоняется.
`pnpm dev` запускает API. Миграции dev Compose применять явно; тесты его не меняют.

## Запросы и ответы

[receipt-create.request.json](contracts/examples/receipt-create.request.json) — исходный
HTTP body, не seed. Заменить три UUID на IDs последнего seed. Это собственный
пример без секретов; quantity=10. [receipt-posted.response.json](contracts/examples/receipt-posted.response.json)
— синтетический полный ответ проведения, согласованный с примером ReceivingPosted;
сервер генерирует новые document/line/event IDs и время при каждом новом документе.
JSON-файлы не поддерживают комментарии; их поля описаны здесь и в generated OpenAPI.

Создать draft (тело — копия примера с реальными fixture IDs):

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/receipts \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: d4dfe5d2-565b-4820-98d6-2db32d51036b' \
  --data-binary @/tmp/receipt-create.json
```

Ответ 201, Location `/api/v1/receipts/<id>`, X-Correlation-Id UUID; body содержит
id, warehouseId, receivingLocationId, status=draft, createdAt, postedAt=null,
postedEventId=null, lines с id/productId/position/quantity. Actor не передаётся клиентом.

Сохранить id из ответа вместо `<receiptId>`; провести и прочитать:

```sh
curl -i -X POST 'http://127.0.0.1:3000/api/v1/receipts/<receiptId>/post' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: ed3f7369-37b5-4399-aacc-33b447167598' \
  -H 'X-Correlation-Id: dbb37b21-1c4a-4b32-9307-148df1647f4c' \
  --data '{}'
curl -i 'http://127.0.0.1:3000/api/v1/receipts/<receiptId>'
```

Posting 200: тот же документ/строки, status=posted, postedAt UTC, postedEventId UUID.
GET 200 показывает текущее состояние и не требует idempotency key. Время события
совпадает с postedAt; correlationId события — от команды проведения.

Повторить post с тем же key: 200 и исходный snapshot, новый HTTP correlation header.
С новым key: 409 RECEIPT_ALREADY_POSTED. Повтор create с исходным key вернёт
исходный draft snapshot, даже после проведения; текущее состояние запрашивать GET.
Другой body с прежним create key или другой receiptId с прежним post key → 409
IDEMPOTENCY_CONFLICT. Не менять ключ после сетевого timeout: commit мог состояться.
Ошибки не сохраняются; после устранения причины можно повторить исходный key.

## SQL-доказательство

[receiving-result.sql](examples/receiving-result.sql) — read-only psql script.
Передать `-v receipt_id=<id>` и безопасно подключиться к локальной БД привычным
способом без размещения credentials в истории команд. Например из backend-хоста,
где libpq уже настроен: `psql -v receipt_id=<id> -f docs/examples/receiving-result.sql`.
SQL поддерживает psql подстановку, не является приложенческой migration.

На новом seed set для одного документа quantity=10 результат:

| Проверка | Ожидание |
|---|---|
| receipt | posted, postedAt/eventId заполнены |
| stock_balance | onHand=10, reserved=0 |
| movement с operationId=line.id | 1, quantity=10 |
| outbox receipt event | 1, aggregateVersion=1, eventId=postedEventId |
| delivery | inventory.putaway, pending, attempts=0 |
| stream | lastCompletedVersion=0, lease отсутствует |
| audit данного документа и его движения | 3 записи: создание, начисление, проведение |
| putaway_tasks | таблица ещё отсутствует, заданий нет |

Если stock существовал до сценария, баланс увеличится на 10, абсолютное значение
будет иным. Не умножать строки JOIN для подсчёта событий: script считает их отдельным
подзапросом по документу. Worker WMS-109 пока без handlers; после WMS-110 ожидания delivery/task потребуют обновления.

## Проверка и диагностика

`pnpm test` запускает unit и реальные PostgreSQL integration suites;
`pnpm typecheck`, `pnpm openapi:check`, `pnpm contracts:check` — локальные gates.
[receiving.spec.ts](../apps/backend/test/integration/receiving.spec.ts) проверяет
happy path, конкуренцию и SQL fault injection. Docker обязателен; skip/fallback нет.
При отказе сохраните receiptId/correlationId и безопасный problem code;
сырой SQL/credentials не выдаются. Автоматического retry нет; [transactions](transactions.md).
Логи/метрики/tracing — будущие WMS-401/402, worker protocol готов WMS-109, handler — WMS-110.
