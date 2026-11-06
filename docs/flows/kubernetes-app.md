# WMS-302: API, worker и миграции в Kubernetes

Владелец описания application chart. Бизнес-сценарии и SQL-invariants остаются у
модулей приложения. [Подготовка kind](kind-helm.md), [AC и evidence](../reports/wms-302.md).
Gateway/TLS и полноценные readiness/lifecycle проверки — WMS-303/304.

## Участники, доверие и ресурсы

Оператор выбирает context/namespace и image. Chart принимает **repository + sha256
digest**, а не изменяемый tag. API, worker и migrator получают одну ссылку image,
но запускают `node dist/main.js`, `node dist/worker.js` и
`node dist/infrastructure/database/migrate.js`. API Service — ClusterIP port 3000;
worker не имеет HTTP Service или фиктивного readiness probe.

`values.schema.json` проверяет digest, Secret names, HTTPS origin и явные сроки.
Числовых defaults сессии нет. Сервер повторно проверяет диапазон 30..86400 и
idle<=absolute. Ошибка runtime policy запрещает старт нового API; старый API
остаётся в RollingUpdate с maxUnavailable=0. Складские права — session/ACL сервера,
а не namespace/service account или переданные в values actor IDs.

ConfigMap хранит только NODE_ENV/HTTP_HOST/PORT и auth policy. Существующие Secrets
runtime/migration содержат ключ DATABASE_URL. Runtime login должен наследовать
только группу warehouse_app, не владеть БД/таблицами и не иметь DDL/CREATEROLE.
Migration login — доверенный администратор локальной БД с правом migrations/CREATEROLE.
Kubernetes service account не заменяет DB role: runtime и migration имеют разные SA,
без Role/RoleBinding и automountServiceAccountToken. Администратор namespace всё равно
может читать Secrets/exec — это явная trust boundary.

Контейнеры работают с UID/GID 1000, runAsNonRoot, readOnlyRootFilesystem,
allowPrivilegeEscalation=false, drop ALL и seccomp RuntimeDefault. /tmp — отдельный
memory emptyDir 16Mi; запросы/лимиты CPU и RAM заданы в values. Grace 30s больше
worker drain 15s. Существующий /health — liveness процесса; startupProbe ждёт начало
HTTP. Отдельной проверки readiness БД ещё нет; Running worker не доказывает отсутствие
зависания, это не обещание WMS-304.

## Подготовка platform dependencies

Chart приложения не устанавливает PostgreSQL, Gateway или CRDs. Для локального
стенда `infra/kubernetes/postgres-dev.yaml` содержит Service, StatefulSet PostgreSQL
17.9 с закреплённым digest и PVC 1Gi/RWO/standard. Namespace задаётся kubectl `-n`.
Secret warehouse-postgres с POSTGRES_PASSWORD требуется заранее. Образ PostgreSQL
использует свой штатный entrypoint с инициализацией data directory; securityContext
backend-контейнеров к этому отдельному platform manifest не применяется.
Это dev DB owner и одна реплика, не production provisioning или HA.

Не копируйте рабочую Compose .env. Подготовьте в защищённом каталоге файлы
`POSTGRES_PASSWORD`, `runtime-url` и `migration-url`, права 0600. URL passwords
кодируются по правилам URL. Host БД внутри namespace — `postgres:5432`.
Не передавайте password через argv, `--set` или checked-in values.

```sh
# Все команды из root; KUBECONFIG/context указывают только на выбранный local cluster.
kubectl --context kind-warehouse-dev -n warehouse-dev create secret generic warehouse-postgres --from-file=POSTGRES_PASSWORD=/secure/POSTGRES_PASSWORD
kubectl --context kind-warehouse-dev -n warehouse-dev apply -f infra/kubernetes/postgres-dev.yaml
kubectl --context kind-warehouse-dev -n warehouse-dev rollout status statefulset/postgres --timeout=120s
kubectl --context kind-warehouse-dev -n warehouse-dev create secret generic warehouse-runtime --from-file=DATABASE_URL=/secure/runtime-url
kubectl --context kind-warehouse-dev -n warehouse-dev create secret generic warehouse-migration --from-file=DATABASE_URL=/secure/migration-url
```

До первой установки provision runtime login и unprivileged NOLOGIN warehouse_app
через доверенный DB-admin канал. Существующие SQL migrations проверяют безопасность
group и выдают ей нужные grants. Не назначайте runtime login владельцем объектов.
В gate роль создаётся только в disposable БД со случайным синтетическим паролем.
Смена Kubernetes Secret не меняет пароль существующего PostgreSQL volume: менять
DB login нужно отдельно согласованной SQL-операцией. Для rotation credentials после
обновления Secret явно выполнить rollout restart API/worker. Chart не читает Secret
через lookup и не вычисляет checksum секретных значений.

## Migration Job и rollout

```mermaid
sequenceDiagram
  participant H as Helm operator
  participant J as pre-install/pre-upgrade Job
  participant P as PostgreSQL
  participant A as API/worker Deployments
  H->>J: revision Job, image digest, migration Secret reference
  J->>P: выделенный client + session advisory lock
  Note over J,P: один lock namespace на БД, до journal lookup
  J->>P: Drizzle journal + pending SQL в transaction
  alt SQL/file/DB ошибка
    P-->>J: rollback SQL transaction
    J->>P: уничтожить client, снять session lock
    J-->>H: failed; backoffLimit 0
    Note over H,A: новые Deployments не применяются
  else SQL success
    P-->>J: commit journal и schema
    J->>P: уничтожить client, снять session lock
    J-->>H: Complete
    H->>A: применить ConfigMap, API и worker
  end
```

Hook SA с weight -10 создаётся до Job. Job `<release>-migrate-<revision>` имеет
release/revision identity; для длинных release names prefix сокращается с hash,
чтобы сохранить DNS length. activeDeadlineSeconds=180 ограничивает весь Job,
backoffLimit=0/restartPolicy=Never исключают скрытый автоматический retry SQL.
Helm timeout должен быть больше deadline Job, например 240s.

`applySerializedMigrations` получает один pool client, задаёт lock_timeout 120s и
берёт `pg_advisory_lock(1464685363,302)` **до чтения журнала**. Drizzle использует
тот же client, не pool. Параллельные releases/CLI одной БД ждут и после получения
lock перечитывают journal. Timeout касается и DDL lock waits. Ошибка выходит без
retry; finally вызывает client.release(true), закрывая соединение и session lock.
При потере процесса PostgreSQL тоже освобождает session lock. Все запускатели
должны использовать этот migrator; DBA способен обойти advisory protocol.

Kubernetes может повторно запустить Job/Pod после инфраструктурного сбоя. Это не
exactly-once Pod execution: защитой повторного SQL служит Drizzle journal и lock.
Смена Helm release identity не разрешает повторять уже применённые SQL. Ошибки до
открытия transaction, например CREATE SCHEMA IF NOT EXISTS migrator, могут оставить
пустой metadata schema; мигратор не обещает атомарность всей истории всех releases.
Applied SQL и journal вручную не редактируются.

## Установка и upgrade

В отдельном несекретном values файле оператор задаёт реальный digest и явные сроки:

```yaml
image:
  repository: warehouse-backend
  digest: sha256:<64 hex из собранного и загруженного image>
auth:
  absoluteSeconds: '<явная policy оператора>'
  idleSeconds: '<явная policy оператора>'
```

Это форма, не готовые значения. Локальный backend image сначала соберите и загрузите
в kind по [runbook](kind-helm.md). Для registry image берите RepoDigest, а не image config ID. При local Docker
save/import manifest может нормализоваться: gate сверяет config ID с исходным
image, берёт реальный CRI repoDigest и регистрирует local alias repository@digest.
Для PostgreSQL gate импортирует только платформу host из multi-arch image archive;
platform manifest использует canonical digest из containerd. Значение image.digest одинаково для всех процессов.

```sh
helm lint infra/helm/warehouse -f infra/helm/warehouse/values-dev.yaml -f /secure/release-values.yaml
helm template warehouse infra/helm/warehouse -n warehouse-dev -f infra/helm/warehouse/values-dev.yaml -f /secure/release-values.yaml
helm install warehouse infra/helm/warehouse -n warehouse-dev --kube-context kind-warehouse-dev -f infra/helm/warehouse/values-dev.yaml -f /secure/release-values.yaml --wait --timeout 240s
helm upgrade warehouse infra/helm/warehouse -n warehouse-dev --kube-context kind-warehouse-dev -f infra/helm/warehouse/values-dev.yaml -f /secure/release-values.yaml --wait --timeout 240s
```

Пустой base values намеренно не устанавливается. Secrets не входят в render;
chart создаёт references на заранее provisioned имена, не credentials. Не включайте
секреты в shell env dumps, `kubectl get secret -o yaml` или Helm values/history.
После success проверьте реальный HTTP ответ и Worker ready; Helm deployed сам по
себе не доказывает работоспособность всех складских команд.

## Expand/contract и совместимость

1. Выпуск expand только добавляет совместимые структуры, nullable/defaulted fields,
   индексы и функции; старый API/worker должен продолжать читать/писать старую schema.
2. Pre-upgrade Job применяет expand, пока старые processes ещё обслуживают запросы.
   На текущем выпуске новых business migrations нет: повтор journal проверяет эту
   последовательность на неизменной schema, не доказывает совместимость будущего SQL.
3. После успеха выполняется RollingUpdate. Новые handlers должны понимать retained
   envelope versions и старые producer payload. Не менять опубликованный enum молча.
4. Contract — отдельный будущий release после завершения всех старых pods/CLI и
   backfill/replay, со своей migration/recovery policy. Удаление/rename поля в pre-hook
   текущего rollout запрещено. Destructive migrations автоматически не классифицируются.
5. Helm rollback откатывает manifests/image, **не SQL schema**. Выпускать rollback
   можно только при совместимости прежнего image с уже применённым expand. --atomic
   тоже не откатывает DB и hook resources. Backup/restore и DBA recovery планируются отдельно.

## Отказы, диагностика и восстановление

```sh
kubectl --context kind-warehouse-dev -n warehouse-dev get pods,jobs,deployments,services,pvc
kubectl --context kind-warehouse-dev -n warehouse-dev get events --sort-by=.metadata.creationTimestamp
kubectl --context kind-warehouse-dev -n warehouse-dev logs job/warehouse-migrate-1
kubectl --context kind-warehouse-dev -n warehouse-dev logs deployment/warehouse-api
kubectl --context kind-warehouse-dev -n warehouse-dev logs deployment/warehouse-worker
helm status warehouse -n warehouse-dev --kube-context kind-warehouse-dev
helm history warehouse -n warehouse-dev --kube-context kind-warehouse-dev
```

- Job Pending/CreateContainerConfigError: проверить наличие Secret/key, image digest,
  свободные resources. Не печатать Secret values.
- DB ещё не готова: Job может завершиться connection error через bounded pool timeout.
  Это явный отказ, не автоматический retry. Исправить DB и повторить upgrade.
- Migration failed: сохранить безопасные diagnostics, определить причину/SQLSTATE,
  проверить journal под администратором. Не удалять journal/PVC и не переписывать
  applied SQL. Новый исправляющий SQL — новая migration.
- Hook failure на install оставляет failed release без workloads. После проверки
  исправить причину и выполнить upgrade (или явный uninstall/install). На upgrade
  прежние Deployments не изменяются до hook success.
- Job Complete, но API CrashLoop: проверить auth policy, runtime grants, ConfigMap и
  runtime Secret. Новый API не становится healthy; старый Pod остаётся доступным.
- Истёк migration lock timeout: выяснить владельца lock в pg_locks/pg_stat_activity,
  не завершать чужую session автоматически. Исправленный повтор использует journal.

Hook Job и migration SA сохраняются для диагностики и не принадлежат обычному
Helm uninstall lifecycle. Перед очисткой проверить, что release не выполняется;
после сохранения diagnostics удалить конкретные Job/SA или весь disposable cluster.
В production retention/history policy нужно определить отдельно.

`helm uninstall` приложения не удаляет отдельную PostgreSQL StatefulSet/PVC/Secrets.
Порядок backup и необратимого удаления данных — [WMS-301 storage](kind-helm.md#postgresql-и-сохранность-данных).

## Проверки

`pnpm kubernetes:gate` создаёт случайный cluster, namespace, PVC и Secrets без root
.env. Нужны kind 0.33, kubectl 1.37, Helm 3.22 и Docker; WMS_KIND/WMS_KUBECTL/WMS_HELM
позволяют указать путь к binary. Gate собирает image, проверяет render, задержку DB,
initial/repeat Job, runtime DDL refusal, неуспешный hook/auth upgrade, сохранность
journal/PVC после DB restart и uninstall. finally удаляет только свой cluster.
Ненулевой exit — failure; skip/fallback не предусмотрены.

SQL race tests в serialized-migrations.spec.ts используют два наблюдаемых lock waits,
новый синтетический SQL, повтор journal и rollback DDL при ошибке. Это не mocks.
Код chart не даёт доказательства API/worker active rollout, external TLS или gate 3.
