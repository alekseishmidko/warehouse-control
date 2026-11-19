# Исправление P2: неизменность состава picking task

Поручение пользователя: исправить замечание из review консистентности и гонок.
[Source task](../tasks/picking-plan-integrity.json),
[владелец подробного flow и Mermaid](../flows/picking.md#неизменность-состава-плана).
Исполняет агент; пользователь принимает результат. Harness подтверждает только
техническую готовность конкретного snapshot.

## Проблема и границы до реализации

Вход — INSERT picking_lines с существующим taskId и новым storage allocation того
же active заказа. Недоверенный SQL выполняется с правами warehouse_app; role grants
не должны разрешать переписывание сохранённого плана. Дефект не показан как обход
HTTP ACL: endpoint добавления строк отсутствует. Существующие warehouse permissions,
session/CSRF, quantities1..int4MAX, reserve/stock и правила B1–B4 сохраняются.

Ожидаемый результат: header/lines создаются только вместе. После commit создания
INSERT отклоняется, в том числе при конкурентном start. Отказ не меняет task,
balances, allocations, movements, audit/outbox и saved HTTP commands. Обычные
start/confirm/cancel продолжают менять только свои lifecycle/progress поля.
Новых бизнес-решений нет; сохраняется ADR-0023. Внешний deployment и рабочие данные
не входят в задачу. Незакоммиченные изменения WMS-601 не отменяются.

## Критерии и реализация

| AC          | Реализация                                                             | Test title в picking.spec.ts                                                    | Проверка                                                                                          |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| PICK-IMM-01 | INSERT guard migration0035, прежние guards активны                     | runtime cannot append a line after picking plan creation committed              | Valid дополнительный allocation того же заказа;42501 и неизменный SQL snapshot                    |
| PICK-IMM-02 | Отказ до FK wait независимо от конкурентного start                     | concurrent start cannot admit a late picking line validated against ready state | BEFORE UPDATE barrier старта, наблюдение SQL lock/отказа INSERT, неизменный ответ GET и confirm5  |
| PICK-IMM-03 | Header/lines одного runner проходят; обычные progress UPDATE сохранены | runtime creates and executes a picking plan in its creation transaction         | Application owners под warehouse_app создают заказ/резерв/план; HTTP start/confirm завершают план |

Дополнительный migration compatibility gate:
[release-migrations.spec.ts](../../apps/backend/test/integration/release-migrations.spec.ts)
`previous release upgrades without losing operations`. Он применяет candidate миграции
к baseline WMS-506 и проверяет сохранность операций со старым и новым runtime.
Этот gate проверяет старые receiving/worker, а не старый picking executable.
Совместимость picking сверена по неизменённым createTask SQL и проверена под runtime
ролью на candidate; новый guard не меняет columns, DTO или порядок записи header/lines.

## Red/green и пользовательские команды

До migration0035 новые regression cases выполнены на настоящей PostgreSQL:
два отрицательных теста упали, потому что INSERT завершался успешно; положительный
creation/execution case прошёл. В race case существующие guards не отключались.
Test-only trigger удерживал start после order/task locks до UPDATE; старый INSERT
проверял ready и попадал в наблюдаемый FK wait. После снятия barrier оба commit
проходили, что и приводило к падению требуемого ожидания42501.

После исправления полный targeted run трёх suites прошёл:73tests.
Из apps/backend, после актуального test:prepare:

```sh
pnpm exec jest --selectProjects integration --runInBand --runTestsByPath \
  .test-dist/test/integration/picking.spec.js \
  .test-dist/test/integration/reservations.spec.js \
  .test-dist/test/integration/shipping.spec.js
```

Генерация custom scaffold выполнена через Drizzle Kit. Штатный `pnpm db:generate`
завершился с exit0 и No schema changes. Два последовательных `pnpm db:migrate`
завершились с exit0: первый создал schema на пустой disposable БД, второй подтвердил
повторный запуск; trigger0035 установлен ровно один раз. DATABASE_URL передавался
явно только для этой БД; рабочая .env и volumes не изменялись. Финальные результаты
полного pipeline записывает harness.

Полный итоговый запуск из корня:

```sh
pnpm harness:plan docs/tasks/picking-plan-integrity.json
pnpm harness:run docs/tasks/picking-plan-integrity.json
pnpm harness:ready docs/tasks/picking-plan-integrity.json
```

Актуальные результаты gates, Node/pnpm, run UUID, snapshot и private logs хранит
`artifacts/harness/picking-plan-integrity/latest.json`. Readiness не означает
бизнес-приёмку или применение migration к dev/внешнему стенду. После любого изменения
source прежнее evidence считается stale и нужен новый run.

## Review и ограничения

Проверены source и SQL, trigger order, grants, ordinary/late INSERT, поведение после
ожидания, штатные UPDATE и rollback. Повторное review сохраняет один механизм создания
плана и существующий порядок locks. Новый guard использует принятый в0031 механизм
xmin/current transaction; общий framework triggers или дополнительный service не вводится.
Fixture принимает количество начального резерва; новые tests используют прежние owners
вместо копирования stock/allocations логики. Test barrier и соединения освобождаются
в finally; ошибка теста не оставляет callback, владеющий lock.

Migration0035 не меняет структуры/состояния старых строк и не восстанавливает неизвестный
первоначальный состав исторически дополненных задач. Guards не защищают от DBA;
nested/savepoint creation не является поддержанным режимом transaction port.
Backend/web coverage остаётся в scope полного check:pr; SQL trigger проверяется
поведенческими PostgreSQL tests, а не процентом TypeScript coverage.
