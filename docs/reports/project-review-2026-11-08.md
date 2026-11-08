# Ревью кода, бизнес-флоу и архитектуры 2026-11-08

Baseline: commit `a613c1c`, чистый working tree перед ревью. Проверка выполнена
по отдельному запросу на review. Код, конфигурация, зависимости и бизнес-правила
не изменены. Этот отчёт продолжает [предыдущее ревью](project-review-2026-11-07.md),
но содержит новую проверку текущего состояния и новую воспроизведённую гонку.

## Замечания

### R-05 — P2: возврат после частичной сборки нарушает общий порядок stock locks

Место: `apps/backend/src/modules/fulfillment/services/shipping.service.ts:196–200`,
`releaseStorageAndCloseOrder:214–218`. Связанные пути:
`inventory/repositories/shipping-stock.repository.ts:applyEffects` и
`inventory/repositories/reservations.repository.ts:reserve/release`.

Триггер: заказ частично собран, часть резерва остаётся в storage A. Оператор
возвращает собранное в другую, уже существующую storage B, где A сортируется раньше B.
Одновременно другой заказ резервирует тот же SKU на том же складе.

Возврат сначала блокирует shipping и B внутри applyShippingEffects. Затем
releaseStorageAndCloseOrder пытается заблокировать A. Reserve другого заказа
блокирует storage по порядку A → B. Получается цикл: возврат держит B и ждёт A,
reserve держит A и ждёт B. Locks разных orders этот цикл не предотвращают.

Воспроизведено на настоящем PostgreSQL с production services и migrations:

1. Через receiving/worker/putaway подготовлено 10 единиц в A.
2. Заказ резервирует 10; picking переносит 3 в shipping, 7 остаются в A.
3. Запрос отмены переводит заказ в cancel_pending.
4. Через отдельные receiving/worker/putaway в B помещена ещё 1 единица того же SKU.
   Это существенно: B существует до начала конкурирующих транзакций.
5. Возврат 3 единиц в B остановлен тестовым barrier после реального applyShippingEffects,
   до releaseStorageAndCloseOrder; его транзакция и locks остаются открытыми.
6. Production reserve другого заказа на 1 единицу блокирует A и ждёт B.
   Ожидание подтверждено через pg_blocking_pids, а не предположено по задержке.
7. Barrier снят. Результат: возврат успешен, reserve получает SQLSTATE `40P01`.

Следствие: одна корректная пользовательская операция откатывается из-за deadlock;
runner не выполняет auto retry. Это дефект доступности конкурентного сценария,
а не доказанная потеря stock: PostgreSQL откатывает транзакцию-жертву.

Направление исправления: inventory должен заранее заблокировать объединение всех
balances возврата и освобождения storage в одном порядке product/location, до мутаций.
Не переносить запись stock в fulfillment и не маскировать ошибку автоматическим retry.
Нужен постоянный regression test «partial pick → cancel → return в другую storage
против reserve другого заказа» с DB wait/barrier. Текущие shipping tests покрывают
частичный возвратный сценарий и гонки одного заказа, но не это расписание разных заказов.

### R-01 — P2: просроченный worker claim принимается после ожидания locks

Место: `apps/backend/src/infrastructure/worker/repositories/worker.repository.ts:136–143`.
Замечание предыдущего ревью остаётся открытым и воспроизведено повторно.

valid с clock_timestamp вычисляется в target list SELECT FOR UPDATE. Выражение
может вычислиться до ожидания блокировки. Если блокирующая транзакция не изменяет
строки, после её commit метод возвращает ненулевой LockedDelivery, хотя lease
за время ожидания истёк. Комментарий «свежесть проверяется ПОСЛЕ получения locks»
не соответствует этому SQL.

Проверка: production claim, deadline по часам БД, отдельная транзакция удерживает
stream/delivery locks; pg_blocking_pids подтверждает ожидание WorkerRepository.lock;
lease истекает до освобождения locks; lock возвращает объект вместо null.
Следствие: обработчик допускается к работе с истёкшим claim. Двойной складской эффект
этой проверкой не доказан: row locks и processed marker остаются отдельными защитами.

Исправление: сначала получить locks, затем отдельным statement проверить token,
status, cursor и deadline. Аналог уже есть в IdentityRepository.lockSessionAndReadValidity.
Постоянный тест должен покрыть expiry при неизменённых блокирующей транзакцией строках;
существующий тест конкурентных processors проверяет другой случай — изменение состояния.

### R-06 — P3: владелец бизнес-правил всё ещё смешивает текущий статус с историей

Место: `docs/fulfillment-rules.md:236–244`. Здесь picking/shipping/consumed/closed_mixed
названы будущими, а отгрузка и возврат — не реализованными. Ниже, на строках 246–250,
добавлено противоположное уточнение WMS-206. В начале документа указана текущая реализация,
но историческое ограждение относится к исходным таблицам и не устраняет эти утверждения.

Последствие: документ, на который ссылаются как на владельца B1–B4, даёт разные ответы
о поддержке отгрузки и отмены. Центральные domain/operations исправлены в R-03;
это оставшийся отдельный документ, а не повторное открытие исправленного Compose finding.
Нужно перенести историю в reports либо явно оформить весь старый блок как историю,
а фактические ограничения описать один раз со ссылками на актуальные flows/ADR.

## Бизнес-флоу

| Сценарий                | Что прослежено                                                                    | Результат ревью                                                              |
| ----------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Приёмка → outbox → task | Parent lock, stock owner, audit/event/result, повтор доставки                     | Новых замечаний в просмотренном пути нет; lease R-01 остаётся                |
| Размещение              | Task source/quantity, принадлежность target, парные movements, общий context      | Новых замечаний в просмотренном пути нет                                     |
| Резерв → release        | Явный вектор, storage-only, int4, allocation reconciliation, rollback нехватки    | Локальная сортировка есть; композиция с возвратом нарушена R-05              |
| Сборка                  | Самоназначение, active order, remaining, shortage, сохранение резерва             | Частичный факт отделён от shortage; отмена не допускает дальнейший pick      |
| Отгрузка → отмена       | Повторная проверка staged, partial ship, cancel_pending, полный return            | Ledger и атомарность сохранены; конкурентный return требует исправления R-05 |
| HTTP replay             | Session/warehouse ACL до claim и saved result, один runner                        | Не найден обход policy в просмотренных controllers                           |
| UI recovery             | Журнал до fetch, тот же key/body при явном повторе, 408/5xx как неизвестный исход | Рассмотрены client/journal/session/workspace и связанные тесты               |
| Чтение/аудит            | Warehouse policy, retained scope, keyset с microseconds                           | Нет нового замечания в просмотренных общих путях                             |

## Архитектурное ревью

Модульный монолит соответствует выбранному масштабу. API и worker имеют отдельные
entrypoints и graphs; InventoryHttpModule отделяет HTTP/auth от worker inventory.
Controllers используют сервисы владельцев, repositories остаются внутренними
providers. Stock/allocations изменяет inventory. Полиморфное чтение audit scope
использует retained связи; это известное исключение ADR-0025, не скрытая запись
в чужой модуль. Shared transaction/pagination contracts отделены от SQL adapters.
Frontend использует generated HTTP types и не импортирует backend runtime.

Существенный недостаток композиции — R-05: гарантия порядка блокировок должна
охватывать весь use case, а не только один вызов repository. Новая универсальная
абстракция или микросервис для исправления не нужны; решение должно оставаться
в границе inventory с передачей общего TransactionContext.

Helm отделяет application resources от установки platform dependencies. Migration
Job использует отдельный Secret и сериализованный migrator на одном соединении.
Gateway сохраняет /api, web получает остальные маршруты. Lifecycle WMS-304 ещё
открыт: у API нет отдельной readiness по зависимостям, у worker нет собственного
probe. Поэтому текущий chart не доказывает rollout без ошибок и HA. Это известный
незавершённый этап плана, а не новая реализованная гарантия или отдельный дубликат finding.

## Проверки и границы

Полный проект проверен по подсистемам, не только по diff. Ручное чтение сосредоточено
на service/repository путях receiving, inventory, fulfillment, identity, worker,
idempotency, транзакциях, чтении/audit, web transport/recovery и Helm/Gateway.
Это не утверждение о построчном чтении каждого generated файла или всех migrations.
Полный статический gate и тесты охватывают более широкое дерево.

- `pnpm check:pr`: 40 backend suites / 578 tests прошли; web — 37 tests.
  Включены lint, architecture guard, contracts/OpenAPI, typecheck/build,
  PostgreSQL integration, Chromium и Compose TCP readiness regression.
- Backend coverage: statements/lines 90.54%, branches 94.50%, functions 89.78%;
  web: statements 57.77%, lines 62.20%, branches 72.36%, functions 52.81%.
  Baseline обоих приложений без регрессий. Coverage не покрывает все расписания locks.
- `node /tmp/wms-review-return-race.cjs`: exit 0 означает успешное воспроизведение
  дефекта R-05, результат `[ok, 40P01]`, а не успешность обеих операций.
- `node /tmp/wms-review-worker-lease.cjs`: exit 0 означает воспроизведение R-01.
  Оба диагностических скрипта используют отдельные Testcontainers БД и finally cleanup.
  Они находятся во временном каталоге, не являются постоянными regression tests проекта.
- Новый kind install/uninstall, Docker image scan, внешний deploy и нагрузочное
  исследование здесь не выполнялись. Runtime/configuration не изменялись.
  Старый R-04 по dev dependencies не перепроверен новым audit; его прежняя оценка
  не выдаётся за актуальную проверку advisory database.

Рекомендованный порядок исправления: R-05 с постоянным concurrency test,
R-01 с тестом expiry после wait, затем R-06. Новые бизнес-политики для этих
исправлений не требуются. Исправление кода этим запросом на review не выполнялось.
