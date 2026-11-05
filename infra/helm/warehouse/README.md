# Helm chart Warehouse Controller

Chart создаёт только ConfigMap с именем выбранного профиля. Это проверяемая основа
Helm release, а не запуск приложения. API, worker и migration Job относятся к
WMS-302, Gateway — к WMS-303. Chart не устанавливает PostgreSQL, Gateway API,
NGINX или другие platform dependencies; credentials здесь не хранятся.

`values.yaml` задаёт base profile, `values-dev.yaml` явно выбирает local dev.
Helm ownership release привязан к namespace и release name. Параметр profile —
недоверенная строка; Helm требует непустое значение и выводит его как YAML string.
Команды, versions, storage, lifecycle, проверки и ограничения —
[владелец flow](../../../docs/flows/kind-helm.md).
