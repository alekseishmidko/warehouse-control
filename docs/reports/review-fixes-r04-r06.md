# Закрытие R-04, R-05 и R-06

## Требования до изменения

R-05: оператор подтверждает полный возврат cancel_pending заказа с остатком резерва
в storage; параллельный order_manager резервирует тот же SKU для другого заказа.
Session/ACL/idempotency и один TransactionContext сохраняются. Inventory владеет
stock/allocations; fulfillment удерживает order lock. Успех обеих допустимых команд
не должен зависеть от deadlock/retry. SQL/audit/outbox ошибки откатывают весь сценарий.
Новые бизнес-политики, schema migrations, retry и внешние deploy не входят в задачу.

| AC        | Результат                                                                           | Проверка                                                                                                 |
| --------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AC-R05-01 | Полный набор stock locks отмены приобретается до изменений stock в общем порядке    | Реальный PostgreSQL: partial pick → return B против reserve A→B; DB wait/barrier, обе команды успешны    |
| AC-R05-02 | Возврат/остаточный release не искажают ledger, movements/audit/result атомарны      | Shipping/reservation suites, reconciliation и full gate                                                  |
| AC-R06-01 | Владелец B1–B4 описывает текущую реализацию; история отделена от действующих правил | Сверка states/формул/лимитов с DTO/services/ADR, local links                                             |
| AC-R04-01 | Уязвимые dev dependency paths устранены без suppression advisory                    | Full/prod pnpm audit, lockfile review и poisoning regression; остаточный registry signal явно указан     |
| AC-R04-02 | Обновлённые инструменты реально выполняют поддерживаемые команды                    | Frozen install, Nest build/dev, drizzle generate, lint/self-tests, PostgreSQL/Chromium/Docker/kind gates |

Статус критериев определяется таблицей evidence ниже. Рабочая .env, dev volumes и существующие изменения
WMS-304 сохраняются. Изменяются только необходимые пути и их документация.

## Уточнение AC-R04-03 до исправления shutdown

Реальный `pnpm dev:all` на новом lockfile запускает API/worker/web, но SIGTERM во время
первой Vite dependency scan даёт esbuild EPIPE и exit1. Supervisor сигнализирует всю
группу одновременно, убивая helper до завершения протокола Vite close. Вход — сигнал
остановки своего supervisor; рабочие данные не меняются. Требование AC-R04-03: Vite
получает graceful SIGTERM как владелец helper, а по общему deadline группа по-прежнему
получает SIGKILL; ошибка/зависание не превращаются в ложный успех.
Regression `graceful web shutdown lets the parent close its helper before group kill`
в `scripts/dev-all.test.cjs` воспроизводит отказ до изменения production кода с двумя
реальными процессами и IPC barrier. Изменение относится к проверяемому dev entrypoint.

## Реализация и повторное ревью

R-05: `ShippingStockRepository.applyEffects` читает retained allocation→order связь
и добавляет все активные storage balances заказа в общий Map shipping source/target.
Сортировка product/location и ensure/UPDATE locks выполняются до изменений stock.
Последующий `releaseStorageAndCloseOrder` получает уже принадлежащие context locks.
Order lock удерживается вызывающим fulfillment; сервис проверяет непустой вектор
одного заказа. Новых записей в чужие таблицы, новых транзакций или retry нет.

AC-R05-01 в `shipping.spec.ts` использует production receiving/worker/putaway и
разные sessions двух заказов. Две настоящие storage UUID сортируются до размещения,
поэтому A<B не зависит от удачной генерации. После partial pick 3 из 10 возврат в B
удерживается после настоящих effects. Другой reserve ждёт; `pg_blocking_pids` доказывает
блокировку. После снятия barrier оба ответа 200. Итог A=H7/R1, B=H4/R0, shipping=H0/R0;
reserved=SUM(active), ровно один return effect, исходный key возвращает тот же snapshot.
Все pending promises наблюдаются; finally снимает barrier и восстанавливает spy.
До hook HTTP failure завершает ожидание через Promise.race, а не зависает на barrier.
До source fix тест получил503 вместо200; после fix shipping suite:28/28.

R-06: `fulfillment-rules.md` описывает текущие статусы active/closed_mixed,
обязательный picking start, transferred/consumed, полноценные shipment/return и
точные границы B1–B4. Исторический текст перенесён целиком в report с явным предупреждением.
Anchor «Принятые решения» сохранён. Будущие TTL, физическая блокировка при shortage,
корректировка и клиентский возврат не выданы за существующие функции.

R-04: Nest CLI закреплён 11.0.24; runtime Nest/TypeScript и бизнес-контракты не обновляются.
Root devDependency TypeScript 5.9.3 закрепляет прежнюю версию compiler для ESLint peers:
при регенерации lockfile autoInstallPeers выбрал 6.0.3, что обнаружено и устранено
повторным review lockfile. В итоговом дереве TypeScript 6/7 нет.
Уязвимые ranges glob/minimatch и esbuild Drizzle loader обновлены точечными overrides.
Старые glob7/minimatch3/5 не попадают в advisory ranges и сохранены для callback consumers.
Deepmerge 4.3.1 в Jest и fork-ts-checker исправлен через `pnpm patch-commit`: фильтруются
опасные ключи source И target, включая null-prototype и own `__proto__` input.
Исправлены source/CJS/UMD. Тест загружает package именно через оба реальных consumer paths,
проверяет root/nested poisoning, обычные globals/.all/массивы и UMD. До patch он падает;
после patch все 3 security/compat tests проходят. Проверены также настоящий archiver
include/exclude и esbuild TS/CORS через Drizzle loader. Advisory не подавляется.

[Deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) не содержит
исправленного upstream-релиза на 2026-11-09. Registry сопоставляет версию, а не patch hash:
`pnpm audit --json` сохраняет exit1 и 1 low, moderate/high/critical=0.
`pnpm audit --prod --json` — exit0, все advisory counters=0. Исходное замечание о
уязвимом коде устранено локальным patch; отсутствие upstream release остаётся
ограничением сопровождения, а full audit нельзя назвать зелёным.
Источники обновлений: [esbuild](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
[glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).

Повторное ревью охватило source/test diff и связанных владельцев shipping/reservations,
DTO/state transitions, order/allocation/balance locks, rollback/replay, dependency consumers,
patch hash/frozen installs, оба Dockerfile и clean-context script, dev supervisor и deadline.
Обнаружены и исправлены связанные дефекты: clean image check не переносил patch-файл;
graceful SIGTERM всей web группе обрывал Vite↔esbuild protocol; polling пропускал быстрый
terminal state migration Job; setup login начинался до готовности новой API revision.
Исправлена также иерархия внешнего kind command deadline. Поведенческие случаи закреплены
red/green regression и реальными entrypoints. Новых подтверждённых
дефектов в этой области повторное ревью не выявило; доказательство всех возможных
interleavings проекта не заявляется. Миграции, рабочие env/volumes и внешние deployment
не изменялись. Ранее внесённые изменения WMS-304 сохранены.

## Команды и evidence

Команды выполнялись из корня на Node 24.19.0/pnpm 10.18.3. Compose/host команды использовали
свои UUID project, synthetic credentials, динамические порты и отдельный volume;
рабочая .env использовалась как исходный файл без записи. Cleanup удаляет только
ресурсы своего теста. Ниже перечислены реальные entrypoints, а не замены unit tests.

| Команда                                                                                                                                                                                               | Результат                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                      | Exit0, patch применён, lockfile без перегенерации                                                                                                                                     |
| `pnpm test:dependencies`                                                                                                                                                                              | Exit0, 3 tests; до patch poisoning test падал                                                                                                                                         |
| `pnpm test:dev`                                                                                                                                                                                       | Exit0, 10 tests; новый parent/helper case падал до fix                                                                                                                                |
| `pnpm --filter @warehouse/backend test:prepare` + `pnpm --filter @warehouse/backend exec jest --selectProjects integration --runInBand --runTestsByPath .test-dist/test/integration/shipping.spec.js` | Exit0, 28 tests; до source fix 27 passed/1 failed (503)                                                                                                                               |
| `pnpm db:generate`                                                                                                                                                                                    | Exit0: No schema changes, nothing to migrate; новые SQL не созданы                                                                                                                    |
| `pnpm db:up`, `pnpm db:migrate`, `pnpm start`, `pnpm worker`, `pnpm dev:all`, `pnpm dev`                                                                                                              | Exit0; API readiness200/business401, worker readiness200, web200; SIGTERM exit0, own resources cleaned                                                                                |
| `pnpm docker:image-check`, `pnpm docker:image-check -- --web`                                                                                                                                         | Exit0: чистые no-cache builds, canary отсутствует во всех runtime layers; web read-only/non-root HTTP200/SIGTERM0                                                                     |
| `pnpm docker:gate`                                                                                                                                                                                    | Exit0: Gate1, migration/restart/durable worker/putaway/reserve/auth и SIGTERM. Первый concurrent с host run завершился compose up failed; причина не доказана. Повтор отдельно прошёл |
| `pnpm db:up`, `pnpm app:migrate`, `pnpm app:up`, `npm run app:up`, `pnpm app:down`, `pnpm db:down`                                                                                                    | Exit0; настоящий API200/anonymous401; исходный npm entrypoint повторён, disposable volume удалён                                                                                      |
| `pnpm audit --json`                                                                                                                                                                                   | Exit1: 1 low (patched deepmerge version), 0 moderate/high/critical; suppression нет                                                                                                   |
| `pnpm audit --prod --json`                                                                                                                                                                            | Exit0: advisory нет                                                                                                                                                                   |

`pnpm check:pr` на итоговом production/test code и зависимостях — exit0:
591 backend test/43 suites, 37 web tests/4 files. Включены generation diff,
ESLint/typecheck/build, architecture/negative guards, dependency compatibility,
10 dev-process tests, real PostgreSQL, Chromium и coverage baseline guards.

Первый чистый `pnpm lifecycle:gate` — exit0: Helm lint/template, install/upgrade,
migration/config failures, HTTPS/CSRF/forwarded headers, UI receive10→putaway→ship3→stock7,
DB outage, Pod kills до/после commit, lease recovery и compatible v1 backlog rollout;
uninstall сохраняет PVC, полный cleanup удаляет собственный кластер.
После финального закрепления compiler peers повторяются image/host/Compose/kind gates.
Финальный повтор после всех исправлений завершён: три команды exit0; AC-R04-02 закрыт.
Промежуточные отказы и их диагностика сохранены ниже отдельно от финального результата.

## Coverage и границы

Backend V8: lines/statements90.63%, branches94.54%, functions89.84%;204 source files,
per-file baseline без регрессий. ShippingStockRepository:137/137 lines,2/2 functions,
29/30 branches. Добавленный lock union исполнен реальной race проверкой; это не
доказательство всех возможных конкурентных расписаний.

Web V8: lines62.2%, statements57.77%, branches72.36%, functions52.81%;22 source files,
baseline без регрессий. Backend и web целиком не объявляются покрытыми на100%.
Node scripts, vendor patch entries и child processes/Docker/kind проверяются отдельными
исполняемыми gates; их результаты не прибавляются к Jest/Vitest процентам.
Baseline этой правкой не ослаблен; предшествующее расширение lifecycle baseline
принадлежит WMS-304. Новых migrations и event versions нет.

## Обнаруженная причина отказа инфраструктурного повтора

После успешного первого lifecycle gate следующий финальный повтор не запустил
NGINX data-plane: init несколько раз завершился с Error, rollout истёк. Повтор с
наблюдением init logs дал точную причину:
`write /etc/nginx-agent/nginx-agent.conf: copy_file_range: no space left on device`.
EmptyDir gateway не имел sizeLimit. `df -h /var/lib/containerd` внутри своего kind node:
Docker VM `/dev/vda1`,59G total/56G used/0 available/100%. Свободные20Gi host macOS
не означали свободное место Docker VM. Это отказ среды, а не доказательство ошибки
миграции или приложения; перед очисткой он не выдавался за успешный gate.

`docker buildx du --verbose` подтвердил Warehouse build records. Выполнены только:

```sh
docker buildx prune --force --filter 'description~=@warehouse/|apps/backend|apps/web'
docker buildx prune --all --force --filter 'description~=@warehouse/|apps/backend|apps/web'
```

Первый проход освободил223.3MB, второй5.506GB. Фильтр выбирал cache по указанным descriptions;
общий Docker prune, удаление volumes/работающих контейнеров и изменение Docker VM settings
не выполнялись. [Семантика фильтра](https://docs.docker.com/reference/cli/docker/buildx/prune/)
проверена по официальной документации. Дополнен troubleshooting Kubernetes flow.
Повтор после очистки выполняется на чистом кластере, без изменения startup/readiness
бюджетов приложения и без skip; внешний бюджет kind описан отдельно ниже.

После первой очистки финальный повтор отдельно завершился на `kubectl wait --for=delete
pod/postgres-0 --timeout=60s`; диагностический namespace был пуст. Причина именно этого
отказа не доказана. Прогон также сохранён как exit1, а не подменён успехом предыдущего.
В Docker VM оставалось6.9G; старые intermediate COPY records продолжали удерживать
слои dev install. Из verbose cache graph выбраны64 точных ID: producers с `@warehouse/`
и только их потомки. Выполнен `docker buildx prune --all --force --filter 'id~=^(...)$'`
с перечислением этих ID в regex, без общих parent/base records. Освобождено ещё11.1GB.
Проверка `docker run --rm --entrypoint df warehouse-backend:local -h /` показала
59G total/39G used/18G available/69%. Имена cache IDs временны и не являются командами
для повторного использования на другой машине. Финальные три gate прошли с этим запасом места; Docker VM settings не менялись.

## AC-R04-04: наблюдение быстрой migration attempt до исправления gate

После освобождения18G новый gate остановился на observation deadline: migration Job
уже Failed/exit1 при намеренно остановленной БД, но harness ожидал только Running.
Это допустимая быстрая неуспешная попытка; polling мог полностью пропустить Running.
Критерий AC-R04-04: наблюдать начавшуюся либо завершённую попытку, затем по-прежнему
проверять отсутствие workloads и при неуспешном install выполнять явный повтор после восстановления
БД. Pending не доказывает попытку. Проверка не добавляет retry и не разрешает успешный
install без БД. Требование закрепляется regression до изменения predicate.

Regression AC-R04-04 сначала подключён к прежнему Running-only predicate и дал
false вместо ожидаемого true для уже Failed попытки. Исправление учитывает также
terminated. Pending/отсутствующий containerStatus остаются false; terminal не означает
успех миграции. Проверки install result, workload gating, DB journal и recovery не удалены.
Первые два постоянных теста `kubernetes-state.test.cjs` проходят и включены в check:pr через
`pnpm test:kubernetes:observations`. Повторное review helper/caller не выявило обхода
migration gate: функция определяет только факт попытки, не результат установки.
Все три затронутых entrypoints Kubernetes/Gateway/Lifecycle проверены последовательно, exit0.

## AC-R04-05: готовность текущей API revision до login

Диагностический lifecycle gate воспроизвёл403 первого login: API Pod старого шаблона
ещё Running, новый Pod имеет Ready=false/started=false. Проверка только отсутствия
`deletionTimestamp` принимала два одновременно живых Pod. Anonymous GET401 мог прийти
от старого AUTH_ORIGIN. Требование AC-R04-05 до исправления: ждать observed generation,
updated/available/total replicas текущего Deployment и ровно desired Ready Pods без
terminating старого Pod. Только затем GET401 и единственный auth POST. Не добавлять
POST retry, не ослаблять Origin/CSRF и не считать Helm wait доказательством rollout.

## Иерархия deadline kind create

Следующий isolated Kubernetes прогон завершился после Starting control-plane/CNI/StorageClass,
но до записи kubeconfig. Внешний execFileSync имел тот же180s бюджет, что внутренний
`kind create --wait 180s`, хотя включает также подготовку узла. Одинаковые бюджеты могли прервать kind до завершения его собственного wait.
Признак ETIMEDOUT прежний driver не сохранял; точный сигнал того отказа не установлен.
Внешний бюджет увеличен до300s; внутренняя проверка Node Ready180s сохранена. Для ETIMEDOUT driver теперь
выводит безопасную метку command deadline exceeded. Это не увеличивает startup/readiness
бюджеты приложения. Проверка — повтор исходных entrypoints с реальным kind, а не
запуск с отключённым wait. Причина отдельных upstream restore timeout не доказана;
403 setup установлен отдельно и закреплён AC-R04-05.

AC-R04-05: regression со старым Running/Ready Pod и новым неготовым Pod получил true
вместо false на прежней проверке `every(!deletionTimestamp)`. Исправление учитывает
observed generation, updated/available/total replicas, ровно desired Pods и их Ready
conditions. Все4 Node regression tests проходят. Сохранены строгие Origin/CSRF и
единственный login POST. Подробности перенесены также к владельцу Gateway flow.
Последний полный `pnpm check:pr` после этих изменений — exit0,591 backend/37 web,
4 Kubernetes status regression, без регрессий baseline. Финальные kind/Gateway/Lifecycle
команды выполнены отдельно от coverage нагрузки, exit0. Промежуточный Gateway mode прошёл
TLS/auth и UI stock7, но завершился timeout восстановления API после scale0→1;
причина именно этого timeout не доказана, результат не был выдан за успешный gate.

## Финальный результат и AC → код → проверка

| AC        | Реализация                                                                                         | Постоянная проверка / итог                                                                         |
| --------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| AC-R05-01 | ShippingStockRepository.applyEffects: union shipping/target/остаточного storage до stock mutations | Shipping integration race с barrier/pg_blocking_pids: обе команды200; закрыт                       |
| AC-R05-02 | Один существующий context, ledger/effects/movements/audit/result без retry                         | Shipping28 tests и полный591-test backend gate: reconciliation/replay/fault rollback; закрыт       |
| AC-R06-01 | Текущий fulfillment-rules и отдельный исторический archive                                         | Сверка DTO/services/ADR и local links; закрыт                                                      |
| AC-R04-01 | Overrides esbuild/glob/minimatch и hashed pnpm patch deepmerge                                     | Реальные consumers/poisoning/CORS/glob, audit prod0; код исправлен, registry1 low остаётся видимым |
| AC-R04-02 | Frozen lockfile, оба Docker inputs, прежний TypeScript5.9.3                                        | Все перечисленные реальные host/Compose/Docker/kind команды выполнены; закрыт                      |
| AC-R04-03 | Graceful SIGTERM самому Vite, deadline SIGKILL всей группе                                         | Parent/helper red→green,10 dev tests, реальный dev:all SIGTERM0; закрыт                            |
| AC-R04-04 | hasMigrationAttempt учитывает terminal attempt                                                     | Постоянный fast-failure regression и все3 реальных gate; закрыт                                    |
| AC-R04-05 | hasReadyApiRevision проверяет текущие replicas/generation/Ready Pods                               | Old/new Pod regression red→green, первый HTTPS login200 в gateway/lifecycle gate; закрыт           |

Дополнительные финальные команды:

| Команда                             | Результат                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:kubernetes:observations` | Exit0,4 tests: migration Pending/Running/terminal и API revision/старые Pods                                                                                                                                       |
| `pnpm kubernetes:gate`              | Exit0: clean install, delayed DB/recovery, migration/config failures, PVC/restart/uninstall и cleanup                                                                                                              |
| `pnpm gateway:gate`                 | Exit0: первый login200 без POST retry, TLS/auth/CSRF/forwarded/body limit, Chromium receive10→putaway→ship3→stock7, неизвестный route, upstream scale0→1/recovery и cleanup                                        |
| `pnpm lifecycle:gate`               | Exit0: полный Gateway gate плюс DB outage без liveness restart, API/worker Pod kills до/после commit, lease recovery, одна запись эффекта, compatible expand migration/v1 backlog rollout, uninstall/PVC и cleanup |
| `pnpm check:pr`                     | Exit0 на финальном исполняемом коде:591 backend/43 suites,37 web/4 files,4 Kubernetes status tests,3 dependency tests,10 dev tests; оба baseline без регрессий                                                     |

Для kind команд использованы реальные tools: WMS_KIND=/tmp/wms301-tools/kind033,
WMS_KUBECTL=/tmp/wms301-tools/kubectl137,
WMS_HELM=/tmp/wms301-tools/helm322/darwin-arm64/helm,
WMS_GATEWAY_CRDS=/tmp/wms303-gateway-crds.yaml; bundle hash проверен driver.
Это локальные пути данной проверки; установка/версии и переменные — у владельцев
kind-helm/Gateway flow. Gate стартовал с чистого кластера для каждой команды.

Повторное review исправленных locks, patch consumers, stop protocol, Kubernetes
predicates/callers и комментариев не выявило новых подтверждённых дефектов в этой
области. Непроверенные глобальные interleavings и Node/child-process coverage gaps
описаны выше. Все исходные R-04–R-06 обработаны; оставшийся registry advisory является
явным ограничением сопровождения vendor patch, а не скрытым нулевым audit.
