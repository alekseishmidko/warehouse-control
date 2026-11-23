# 0040. Локальный GitOps и репетиция release/recovery

- Дата: 2026-11-23
- Статус: Accepted; current runtime/baseline уточнён [ADR-0041](0041-runtime-without-system-openssl.md).
- Основание: пользователь выбрал отдельный local kind ARM64 + SOPS/age и оба этапа.
- Уточняет: [ADR-0028](0028-kubernetes-release-migrations.md) и [ADR-0029](0029-process-lifecycle.md) в части migration ordering;
  [ADR-0005](0005-platform.md) в части GitOps. Обычный Helm mode сохранён.

## Контекст и решение

WMS-602 уже поставила проверенные ARM64 images в GHCR. Для WMS-603/604 нужен
реальный controller и проверка восстановления без доступа к production.
Создаём новый UUID kind, private kubeconfig и Argo CD Core с pinned vendor manifest
и images. Core не создаёт внешний argocd-server/UI. Application управляется через
Kubernetes API. Vendor controller имеет широкие cluster RBAC только внутри этого
disposable cluster. AppProject ограничен одним Git URL, warehouse-dev и перечнем
namespaced ресурсов. Это не multi-tenant production security profile.

Git source — отдельный временный репозиторий с whitelist chart, PG manifest,
environment values и SOPS ciphertext. Он доступен внутри kind через read-only
ClusterIP HTTP server. Ни рабочий .git, ни .env туда не копируются. Application
указывает полный commit; values содержат immutable image digest. Manual sync
сохраняет явное решение оператора. Drift наблюдается и исправляется sync.

Оператор расшифровывает SOPS/age и передаёт Secrets Kubernetes через stdin до sync.
Ключи, kubeconfig и encrypted backup находятся вне Git в private temporary directory.
Argo не расшифровывает Secrets; plaintext не попадает в manifest/render cache.
Сами Secrets не имеют automatic self-heal от Argo. Их изменение требует отдельного
operator reconcile и обновления ciphertext. В репетиции проверяются wrong key,
утрата primary key и восстановление из private копии. Это не production key escrow.

Для deployment.controller=argocd migration SA применяется wave -2, migration Job
выполняется Sync hook wave -1 с BeforeHookCreation; workload — wave 0. Failed SQL
останавливает rollout. Default Helm pre-install/pre-upgrade hooks не меняются.
Успех Job не доказывает совместимость schema: нужен business probe. Committed
несовместимость исправляется новой forward migration; image rollback не отменяет SQL.

Release/recovery использует synthetic HTTP flow, совместимое expand изменение под
нагрузкой, image rollback и отдельную committed-incompatibility репетицию. Backup
шифруется age, восстанавливается в новую DB, сверяется до выбора этой DB обоими
процессами. События вне БД не откатываются. Отдельный существующий real Kafka cutover
проверяет retained source/boundaries до возобновления consumers; kind profile
использует PostgreSQL worker и не включает publisher автоматически.

## Последствия и альтернативы

Core содержит Redis для control-plane cache. Это не Redis/BullMQ бизнес-приложения;
монолит, PostgreSQL outbox и at-least-once остаются прежними. Secret CMP не выбран:
он мог бы раскрыть plaintext в render/cache. Внешний Git hosting и постоянный cluster
не нужны для согласованной локальной репетиции. Thin fixture images не публикуются:
они импортируются в owned kind с проверкой archive config → CRI config/platform digest.

Production потребует отдельного согласования Git/registry credentials, TLS/SSO/RBAC,
HA/storage, ключей/backup escrow, retention и измеренных RPO/RTO. Локальный elapsed
не является production SLO. Cleanup удаляет только owned cluster/images/private files.
Hard kill оператора может оставить resources; автоматический глобальный prune запрещён.

Проверки и команды: [владелец flow](../flows/gitops-release-recovery.md),
[инструменты](../../infra/gitops/README.md), [scripts](../../scripts/gitops/README.md).
Источники: [Argo Core](https://argo-cd.readthedocs.io/en/stable/operator-manual/core/),
[sync waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/),
[secrets](https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/),
[SOPS](https://github.com/getsops/sops), [age](https://github.com/FiloSottile/age).
