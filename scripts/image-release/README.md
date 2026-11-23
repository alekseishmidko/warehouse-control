# Локальная проверка runtime images — WMS-602

Независимая подготовка поставки: скрипт не обращается к целевому registry и не публикует
images. Владелец подробного процесса — [image scan flow](../../docs/flows/image-scan.md).
Пользователь разрешил PR/CI/merge/release и isolated ARM64 target pull; реальные jobs прошли. [Evidence](../../docs/reports/wms-602.md).

`scan.cjs` использует Docker CLI и Trivy 0.76.2, создаёт private UUID-каталог
artifacts/image-scan и удаляет экспортированный tar в finally. Общий atomic-json
writer принадлежит scripts/evidence; второй writer здесь не создаётся.
Source task JSON docs/tasks/wms-602.json описывает согласованный PR/release/pull,
стабильный AC WMS-602.3, accepted base и harness gates. Он не является release evidence.

```sh
pnpm docker:image-check
pnpm docker:image-check --web
WMS_TRIVY=/absolute/path/trivy pnpm images:scan
```

Установите Trivy из [официального release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2)
и сверьте checksum. Для macOS ARM64 tar SHA-256:
`ae7ea358326960406b703c77b2ac490190797d80b306b5b50c2a27221da0a5b8`.
Нужны Docker и сеть для vulnerability DB. Отсутствие binary/DB/report даёт nonzero.
Высокие и критические уязвимости блокируют проверку, даже если исправление отсутствует;
LOW/MEDIUM остаются в полном JSON для разбора. Новые UNKNOWN блокируют проверку.
`policy.cjs` применяет только точные exceptions из `exceptions.json`; формат описан ниже.
Добавление исключения требует review причины, image/package/CVE, срока и компенсирующей
меры; нельзя скрывать его через env/ignorefile.

`WMS_TRIVY` выбирает executable, которому оператор доверяет. Все TRIVY_* overrides
удаляются из scanner environment; отдельный пустой config исключает настройки checkout.
Это защита от случайной конфигурации, а не от привилегированного оператора.
JSON содержит findings OS и библиотек, summary — image ID/hash отчёта/commit/version/sourceSnapshot.
HEAD не доказывает clean checkout; доказательство свежести принадлежит harness.
`scanLocalImages` экспортирует тот же фактический scanner для GitOps baseline, без второго policy.
Inspect ID может быть OCI index; Trivy ImageID сравнивается с config digest archive bytes.
Повтор создаёт новый каталог, прежний failed не переписывается в passed.

Policy и недоверенные JSON проверяет `pnpm test:pr-checks`:
`image scan policy fails closed and binds findings to the inspected image`,
`image scanner discards ambient policy overrides`. Эти tests не заменяют настоящий scan.

## Runtime и review исключений

[ADR-0041](../../docs/adr/0041-runtime-without-system-openssl.md) уточняет ADR-0039:
Node24.22.3 из pinned tooling, официальный base-nossl-debian13 и только нужные C++
packages из pinned cc stage. `cpp-runtime.cjs` копирует фактические package files,
SONAME links/licenses/metadata; системная libssl не входит в lower runtime layers.
Package inventory checksum проверяется, unsafe paths/SSL payload запрещены. Исходный
cc source доверен по SHA256; package MD5 используется для сверки, не как подпись.
`runtime.cjs` проверяет Node/uid1000, отсутствие tooling/native addons, физическое
отсутствие shared SSL files/package и sharedObjects. Bundled static OpenSSL в Node остаётся.

Fresh scan2026-11-23 отверг старый cc runtime по HIGH CVE-2026-124709. HIGH waiver
не добавлен. Старые опубликованные WMS-602 digests/evidence остаются историческим фактом;
внешняя публикация нового runtime не выполнялась. GitOps/recovery строят и сканируют
текущие local images перед import: [flow](../../docs/flows/gitops-release-recovery.md).

`exceptions.json` — source policy, не ignorefile. Три exact UNKNOWN libc6
2.41-12+deb13u5, Debian13.8, pinned base4006ac92504b и Node24.22.3 истекают2026-12-20 UTC.
Каждая запись: id/package/version/severity/status, OS/base/Node, expires/reason/source.
Wildcard/HIGH/CRITICAL/ignore-unfixed запрещены. FixedVersion, новая severity/version/OS,
просрочка или отсутствие runtime proof (включая systemOpenSSLAbsent) блокируют gate.

| Advisory                                                                       | Область               | Причина                                                                        |
| ------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------ |
| [CVE-2026-121757](https://security-tracker.debian.org/tracker/CVE-2026-121757) | libc6 2.41-12+deb13u5 | CP949 glibc iconv с controlled encoding; Node TextDecoder/Intl использует ICU. |
| [CVE-2026-121758](https://security-tracker.debian.org/tracker/CVE-2026-121758) | тот же libc6          | ISO-2022-CN-EXT decoder glibc iconv; та же недостижимость.                     |
| [CVE-2026-124024](https://security-tracker.debian.org/tracker/CVE-2026-124024) | тот же libc6          | UCS-4 → IBM1390/1399 glibc iconv; та же недостижимость.                        |

Gconv остаётся в filesystem и полном scan JSON; это не исправление glibc. Production
source не вызывает FFI/iconv/child_process, native addons/CLI отсутствуют. Новый native
consumer или внешние mounts требуют нового review. Старые glob/SSL waiver удалены:
они не описывают новый runtime. Regression — `runtime policy rejects unrelated expired
and altered advisory exceptions`, assembly filesystem test и реальные image-check/scan.

## Проверка целевого pull

После publish job отдельный verify-pull на новой ARM64 VM получает только packages:read.
`pull-kind.cjs` принимает RELEASE_BACKEND_REF/RELEASE_WEB_REF, GITHUB_REPOSITORY/SHA/ACTOR
и short-lived GITHUB_TOKEN. Только exact GHCR repository/app@sha256 разрешены. Скрипт
создаёт UUID kind cluster с отдельным private kubeconfig, проверяет ARM64 и отсутствие
release images в CRI cache. Registry Secret передаётся через stdin; Pods не получают
Secret mount или service-account token. imagePullPolicy Always, read-only rootfs, uid1000,
capabilities drop ALL; Node smoke сверяет version/arch/uid. CRI repoDigests связывает
requested digest с фактическим Pod imageID/config. Finally удаляет только свой cluster
и kubeconfig; cleanup failure запрещает passed. Evidence не содержит auth data.
Это не установка WMS/БД и не проверка production target.

## Привязка export к финальному scan

Docker gate строит warehouse-backend:local, поэтому он выполняется **до** imageScan.
`export.cjs` повторно вызывает ready, читает successful imageScan log с проверкой hash,
raw summary/report hashes и policy, проверяет commit и текущий inspect ID. После Docker
save ещё раз считает config digest из tar: это ловит смену tag между inspect/save.
Metadata/commit marker создаются только после успешного экспорта обоих apps; при отказе
собственные partial files удаляются. Existing export directory не переиспользуется.

Checked-images artifact включает export-evidence.json с commit/scan hash/config IDs/tar
hashes; SHA256SUMS покрывает его. Publisher извлекает только expected config IDs через
jq и передаёт их outputs в packages:read verifier. Target CRI id обязан совпасть с
checked configId; одно совпадение Pod registry reference больше не считается достаточным.
Regression проверяет old gate order (red до fix), changed tag, save race, изменённый
raw scan report, отсутствие accepted metadata при отказе и successful bytes export.

## Локальные release fixtures

`fixtures.cjs` добавляет следующий test-only SQL/journal в thin image поверх checked
base, вычисляя idx/when из фактического base journal. Он используется GitOps failure
и release/recovery gate. Source applied SQL не меняется; secret/build args отсутствуют.
Только owned tags импортируются с selected-platform config verification; наружу эти
images не публикуются. [Владелец сценария](../../docs/flows/gitops-release-recovery.md).
`assertPulledConfig` общий для WMS-602 pull и GitOps registry prerequisite;
regression отвергает чужой config и отсутствие requested repoDigest.
