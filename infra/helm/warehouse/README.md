# Helm chart Warehouse Controller

Chart 0.2 создаёт API/worker Deployments, API ClusterIP Service, ConfigMap и
service accounts. Pre-install/pre-upgrade Job использует тот же immutable image
с отдельной migration командой и DB Secret. Runtime role отделена от migrator.
Chart не устанавливает PostgreSQL/Gateway и не создаёт credentials.

Обязательные image digest, Secret names и явную auth policy задаёт оператор;
values.schema.json проверяет структуру. Base values не является готовой конфигурацией.
values-dev.yaml задаёт local Secret names и Never pull policy. /health остаётся
liveness, полноценные probes — WMS-304. TLS/browser hosting — WMS-303.

Файлы templates: accounts — runtime и hook SA, configmap — несекретная среда,
deployments — два процесса, migration — release revision Job, service — API,
_helpers.tpl — общие image/security/env шаблоны и безопасное сокращение имён.

Движение данных, rollout/SQL locks, точные команды, ошибки, безопасный повтор,
expand/contract и tests: [владелец flow](../../../docs/flows/kubernetes-app.md).
