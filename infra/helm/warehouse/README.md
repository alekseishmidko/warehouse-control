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
