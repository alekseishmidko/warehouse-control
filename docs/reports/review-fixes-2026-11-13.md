# Исправления после ревью проекта

## Изменение

Вход: текущая workspace, включая незакоммиченный WMS-404. Рабочие данные и .env
не меняются. Права, stock, lease и HTTP DTO сохраняются. Исправления затрагивают
session lifecycle, публикацию evidence, остановку нагрузки и чтение allocations.
Архитектура остаётся модульным монолитом: fulfillment читает allocations через
inventory service, SQL остаётся в private repository.

## Требования и evidence

| AC ID    | Реализация                                                                                                                 | Проверка                                                                                                 | Результат                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| AC-RF-01 | ApiClient session revision; SessionProvider проверяет эпоху profile/401 и сериализует login/logout ради порядка Set-Cookie | transport.test.ts: stale 401; workspace.test.tsx: late A command, mount profile, failed login            | 41 web tests passed; итоговый общий gate passed     |
| AC-RF-02 | scripts/evidence/atomic-json.cjs; load/recovery используют общий writer                                                    | atomic-json.test.cjs: partial write EIO и rename fault на реальном filesystem                            | passed; прежний JSON сохранён, temp удалён          |
| AC-RF-03 | cancellation.cjs: abort проверяется до/после Docker setup, прерывает settle; cleanup использует raw transport              | load.test.cjs: deferred setup/settle; настоящий SIGINT driver во время settle                            | passed: k6 не запущен, receipts=0, cleanup завершён |
| AC-RF-04 | docs/architecture.md отражает реализованный k6; карта и план ссылаются на этот отчёт                                       | formatter и общий gate                                                                                   | formatter и check:pr passed                         |
| AC-RF-05 | inventory listMany + batch grouping; fulfillment/shipping читают allocations одним запросом                                | reservations.spec.ts: released history, empty line, uppercase UUID, cancel смешанного snapshot           | 58 focused tests passed; 627 backend tests passed   |
| AC-RF-06 | canonicalJson сохраняет request budget; canonicalSnapshotJson проверяет JSON без request byte budget                       | http-foundation.spec.ts; http-commands.spec.ts: большой snapshot commit/replay, большой request отклонён | unit + настоящий PostgreSQL passed                  |

## Найденные и исправленные замечания

- P2, frontend session: поздний 401 команды пользователя A очищал уже открытую
  session B. Теперь ответ влияет на session только в своей эпохе. Поздний profile
  также не восстанавливает A. Login/logout идут последовательно, поскольку браузер
  применяет Set-Cookie независимо от проверки JS-state. Ошибка входа не блокирует
  следующую попытку; складские команды не получают автоматический replay.
- P2, recovery evidence: writeFile в accepted path мог обнулить прежний отчёт до
  отказа записи. Fault injection воспроизвёл потерю старого файла. Теперь writer
  создаёт уникальный wx/0600 temp рядом с target и публикует готовый JSON через rename.
  Это атомарность одного файла, не двух отчётов вместе и не гарантия fsync/power loss.
- P2, load preparation: SIGINT до k6 отмечал interruption, но запуск генератора
  продолжался. Теперь отмена блокирует продолжение подготовки и запуск k6;
  finally продолжает удаление собственных ресурсов.
- P3, architecture: описание называло k6 будущей работой. Исправлено на фактический
  статус WMS-403.
- Чтение allocations делало отдельный SQL для каждой строки заказа. Batch устраняет
  N+1, сохраняет историю, сортировку внутри строки и существующую DTO проекцию.
- Дополнительный P2, canonical-json: валидный server snapshot 312043 bytes
  отклонялся request budget 256 КиБ, из-за чего команда могла откатиться при большой
  истории. Отдельный server serializer использует тот же encoder: циклы, getters,
  non-JSON и depth по-прежнему отклоняются. Размер запроса не ослаблен.

## Повторное ревью

Проверены diff, новые helper files, потребители serialization, inventory →
fulfillment/shipping, ApiClient → SessionProvider/журнал команд, load/recovery cleanup
и публикация evidence. Проверены сохранение атомарности HTTP result с бизнес-эффектом,
отсутствие чужого SQL в fulfillment, стабильный порядок allocations, пустые строки,
актуальный и устаревший 401, очередность credentials и восстановление после ошибки.
На этих путях новых подтверждённых дефектов не найдено. Это не утверждение об
отсутствии дефектов во всём проекте.

Полный объём allocation history сохраняется действующим DTO. Отделение истории
с пагинацией потребует отдельного изменения API; её нельзя молча обрезать лимитом.
Login rate limit через gateway пока использует socket peer: клиенты proxy делят
лимит. Это описанное dev-ограничение; policy доверенных proxy CIDR ожидает отдельного
согласования. Произвольные forwarded headers не становятся доверенными.

## Проверки

Нагрузки и coverage не запускаются одновременно. Выполнены пользовательские entry points:

| Команда                | Результат                                                   |
| ---------------------- | ----------------------------------------------------------- |
| `pnpm load:throughput` | exit 0; чистый стенд, сверка и cleanup                      |
| `pnpm load:sku`        | exit 0; 4 DB waiters, один reserve success / три conflicts  |
| `pnpm load:backlog`    | exit 0; 100 событий, полный drain, сверка и cleanup         |
| `pnpm load:baseline`   | exit 0; три новых стенда, generated baseline обновлён       |
| `pnpm recovery:drill`  | exit 0; 38/38, monitoring faults/recovery, quiet window 60s |
| `pnpm check:pr`        | exit 0; 627 backend / 49 suites, 41 web tests               |

Baseline UTC: 2026-11-13T05:43:00.888Z → 2026-11-13T05:47:13.494Z.
HTTP throughput: p50=8,87 мс, p95=15,61 мс, p99=33,81 мс;
unexpected responses=0, dropped iterations=0. Backlog 100 обработан за 4059 мс
с учётом старта worker. Сверки balances, ledger, allocations и дубликатов прошли.
Полное окружение, ресурсы, images, samples и ограничения —
[generated baseline](wms-403-baseline.json) и [отчёт WMS-403](wms-403.md).
Это dev-измерение receiving/hot SKU, не production capacity/SLO.

Итоговый `pnpm check:pr` завершился с exit 0 на окончательном коде:
format, typed lint, architecture/self-tests, contracts/OpenAPI/web generation,
typecheck/build, native tests, PostgreSQL integration и Chromium gate.
`pnpm test:evidence` — 1/1; `pnpm test:load` — 14/14; `pnpm test:web` — 41/41.
Focused PostgreSQL/unit — 58/58. Baselines: 210 backend и 22 web файла без регрессий.

Coverage Jest/V8 backend: statements/lines 90,81%, branches 94,52%, functions 89,40%.
Vitest/V8 web: statements 59,06%, lines 64,11%, branches 72,34%, functions 53,68%.
Это не 100% покрытия бизнес-веток или всего backend. Chromium evidence не входит
в Vitest denominator. CJS load/recovery/evidence helpers проверены native tests и
реальными entry points, без заявления полного instrumented child-process coverage.
SIGKILL/потеря daemon, power loss, длинный soak и реальная гонка Set-Cookie в разных
browser tabs здесь не проверялись. Очередь credentials действует внутри provider.

Recovery UTC: 2026-11-13T05:47:13.735Z → 2026-11-13T05:52:12.493Z,
[generated evidence](wms-404-evidence.json). Quiet window: 60s, 12 samples, три targets up.
Основные локальные логи: `/tmp/review-fixes-pr-verified.log`,
`/tmp/review-fixes-{cancel,throughput,sku,backlog,baseline,drill}.log`.
Логи /tmp могут быть удалены ОС. Source/config после успешного gate не менялись;
итоговая запись результатов — только этот отчёт, с отдельным formatter check.

Первый общий gate столкнулся с socket setTypeOfService EINVAL в lifecycle;
изолированный повтор 2/2 passed. Прогон со sleep/wake (751s timeout и истекшая session)
не принят. Затем 625 tests прошли, но coverage нашёл две недопокрытые ветки batch
refactor. Baselines не снижены: добавлены проверки пустой строки и cancel смешанного
snapshot. Ошибка сравнения test snapshot до/после cancel исправлена перестановкой
проверки uppercase UUID до изменения состояния, без изменения ожидаемого контракта.

Финальный gate первоначально остановился на Solid lint предупреждении о чтении
reactive user в очереди logout. Исправление использует явный одноразовый snapshot
через untrack. Повторные lint, 41 web test и полный gate прошли без lint exceptions.
