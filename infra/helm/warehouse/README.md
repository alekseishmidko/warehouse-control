# Helm chart Warehouse Controller

Chart 0.2 создаёт API/worker Deployments, API ClusterIP Service, ConfigMap и
service accounts. Pre-install/pre-upgrade Job использует тот же immutable image
с отдельной migration командой и DB Secret. Runtime role отделена от migrator.
Chart не устанавливает PostgreSQL/Gateway и не создаёт credentials.

Обязательные image digest, Secret names и явную auth policy задаёт оператор;
values.schema.json проверяет структуру. Base values не является готовой конфигурацией.
values-dev.yaml задаёт local Secret names и Never pull policy. /health остаётся
liveness; API/worker имеют отдельные startup/ready/live probes WMS-304.
[Budgets, drain и rollout](../../../docs/flows/lifecycle.md). TLS/browser hosting описан в WMS-303.

Файлы templates: accounts — runtime и hook SA, configmap — несекретная среда,
deployments — два процесса, migration — release revision Job, service — API,
_helpers.tpl — общие image/security/env шаблоны и безопасное сокращение имён.

Движение данных, rollout/SQL locks, точные команды, ошибки, безопасный повтор,
expand/contract и tests: [владелец flow](../../../docs/flows/kubernetes-app.md).

Опциональный gateway.enabled добавляет Gateway/HTTPRoute при заранее установленных
CRDs/controller, TLS Secret и web Service. По умолчанию выключен.
[Текущий статус и ограничения](../../../docs/flows/gateway-tls.md).

web.enabled включает отдельный static image с обязательным web.image.digest.
Gateway и web выключены по умолчанию; web Service по умолчанию <release>-web:8080.
gateway.redirectPort задаёт внешний HTTPS порт для local port-forward (обычно 443).

publisher.enabled добавляет один процесс того же backend digest с Recreate, без HPA,
Service и API token. mTLS Secrets существуют отдельно; values содержат только ссылки.
Registry release preflight выполняется до Helm. [Шаги и recovery](../../../docs/flows/publisher.md).
`kubernetes:gate` проверяет optional manifest через server dry-run; actual transport
проверяется отдельно реальными PostgreSQL/Kafka integration и `kafka:gate` ACL.

## Режим Argo CD (WMS-603)

`deployment.controller` принимает `helm` (default) либо `argocd`. Default сохраняет
прежние pre-install/pre-upgrade hooks. Режим Argo CD не выполняет Helm install:
обычный migration ServiceAccount wave-2 → migration Sync hook wave-1 → runtime wave0.
BeforeHookCreation пересоздаёт фиксированный Job при следующем sync. Нулевой backoff
и deadline180s сохранены. Failed Job блокирует переход к Deployments, но не откатывает SQL.
Secrets и PostgreSQL должны быть подготовлены до sync; это не bootstrap этих зависимостей.

Source render regression проверяет оба режима и отвергает неизвестный controller.
Окружение согласовано: отдельный local kind ARM64 + SOPS/age. Live sync/drift/failed SQL migration проверены новым gitops:gate и release:drill.
[Статус, вход и проверки](../../../docs/reports/wms-603.md).
