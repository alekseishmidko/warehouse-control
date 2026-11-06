# Локальные platform dependencies

postgres-dev.yaml — PostgreSQL 17.9 Service/StatefulSet с отдельным PVC standard/RWO
1Gi. Namespace и Secret warehouse-postgres (POSTGRES_PASSWORD) создаёт оператор.
Файл не входит в Helm release приложения: uninstall WMS не удаляет данные.
Это single-node dev owner, не production database/HA или backup. Workloads WMS
получают отдельный runtime login и migration owner через разные Secrets.

Шаги ввода/настройки, ошибки, сохранность, примеры и evidence:
[application flow](../../docs/flows/kubernetes-app.md),
[kind/storage](../../docs/flows/kind-helm.md), [отчёт](../../docs/reports/wms-302.md).
