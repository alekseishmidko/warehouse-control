# Изолированное окружение GitOps

Согласованный профиль WMS-603/604: новый local kind ARM64, Argo Core, PostgreSQL,
WMS API/worker/web и SOPS/age. Постоянное окружение не создаётся. Подробное движение
данных, ошибки и recovery: [flow](../../docs/flows/gitops-release-recovery.md).
Команды и evidence: [scripts](../../scripts/gitops/README.md).

`toolchain.json` — source lock, редактируется после review нового upstream release.
`versions` задаёт версии Argo/SOPS/age. `assets` индексируется OS-architecture; каждый
элемент содержит локальное имя, HTTPS URL, SHA256 исходных bytes и archive flag.
Age archive содержит только два извлекаемых executable. Kind/kubectl версии входят
в их URL. Поддержаны darwin-arm64 и linux-arm64; эмуляции/x64 fallback нет.
`core.url/sha256` фиксируют vendor core-install.yaml; `core.images` сопоставляет
ожидаемые upstream tags точным registry digests. Незнакомый image/изменённый manifest
вызывают отказ. SHA — целостность reviewed bytes, не отдельная подпись поставщика.
Источники hashes: release assets официальных GitHub проектов и kubectl checksum.

Environment values формирует `scripts/gitops/platform.cjs`, затем сохраняет в отдельный
временный Git `environments/local/values.yaml`. Backend/web digests получаются fresh local build/scan/checked import; исторический
WMS-602 pull evidence используется только отдельным registry access probe. SOPS ciphertext сохраняется рядом; keys туда не попадают.
AppProject/Application формируют `core.cjs`/`application.cjs` и применяют через private
kubeconfig. Chart хранится в `infra/helm/warehouse`; дополнительной копии chart нет.

Core Redis обслуживает только Argo cache. Его наличие не меняет бизнес-архитектуру.
Core controller RBAC широкие в disposable kind; ограничения AppProject не заменяют
production cluster isolation. UI/server отсутствует, Service только ClusterIP.
