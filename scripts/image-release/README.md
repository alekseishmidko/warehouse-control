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
JSON содержит findings OS и библиотек, summary — image ID/hash отчёта/commit/version.
HEAD не доказывает clean checkout; доказательство свежести принадлежит harness.
Inspect ID может быть OCI index; Trivy ImageID сравнивается с config digest archive bytes.
Повтор создаёт новый каталог, прежний failed не переписывается в passed.

Policy и недоверенные JSON проверяет `pnpm test:pr-checks`:
`image scan policy fails closed and binds findings to the inspected image`,
`image scanner discards ambient policy overrides`. Эти tests не заменяют настоящий scan.

## Runtime и review исключений

[ADR-0039](../../docs/adr/0039-minimal-node-runtime.md): Node24.22.3 из официального
trixie-slim в pinned distroless cc-debian13. `runtime.cjs` используется scanner и
image-check; `policy.cjs` содержит pure JSON/policy проверки. Scan сохраняет исходный
JSON без фильтрации, summary — все counts, waived entries, runtime proof и policy hash.

`exceptions.json` — source policy, не Trivy ignorefile. Каждая запись содержит точный
id/package/version/severity/status, Debian release, base digest, Node version, expires,
reason и ссылку на первичный источник. Все шесть записей истекают2026-12-20 UTC.
Нет wildcard, исключений HIGH/CRITICAL или общего ignore-unfixed. Найденная FixedVersion,
новая severity/status/package version/OS или отсутствие runtime proof запрещают waiver.
Просрочка/дубликаты/невалидная source policy блокируют весь gate даже при чистом scan.

| Advisory                                                                       | Область                    | Причина применимости исключения                                                                      |
| ------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| [CVE-2026-121757](https://security-tracker.debian.org/tracker/CVE-2026-121757) | libc6 2.41-12+deb13u4      | CP949 через glibc iconv с контролируемыми input/encoding и //IGNORE; Node ICU не вызывает этот путь. |
| [CVE-2026-121758](https://security-tracker.debian.org/tracker/CVE-2026-121758) | тот же libc6               | ISO-2022-CN-EXT decoder glibc iconv; та же недостижимость.                                           |
| [CVE-2026-124024](https://security-tracker.debian.org/tracker/CVE-2026-124024) | тот же libc6               | UCS-4 → IBM1390/1399 glibc iconv с контролируемым memory layout; та же недостижимость.               |
| [CVE-2026-126765](https://security-tracker.debian.org/tracker/CVE-2026-126765) | тот же libc6               | glibc glob/globfree при allocation failure; Node fs.glob использует JS/minimatch, не libc glob.      |
| [CVE-2026-84786](https://security-tracker.debian.org/tracker/CVE-2026-84786)   | libssl3t64 3.5.7-1~deb13u3 | DANE системного OpenSSL; Node статически использует собственный OpenSSL3.5.9.                        |
| [CVE-2026-95690](https://security-tracker.debian.org/tracker/CVE-2026-95690)   | тот же libssl3t64          | DTLS системного OpenSSL; та же недостижимость.                                                       |

Review CVE-2026-126765: Debian указывает affected/unfixed для trixie.
[Node24.22.3 fs.glob source](https://github.com/nodejs/node/blob/v24.22.3/lib/internal/fs/glob.js)
использует JS/minimatch и readdir/stat. Вместе с отсутствием native addons/CLI/FFI это
основание адресного исключения. Уязвимость затрагивает все архитектуры; ARM64 не является защитой.

Gconv/libssl остаются в filesystem и полном JSON. Это не утверждение об исправлении
библиотек. Review production source не выявило FFI/iconv/child_process. Runtime probe
подтверждает отсутствие iconv/openssl CLI, .node addons и shared libssl/libcrypto.
Остаточный риск: новый JS/native consumer или внешние mounts могут изменить применимость;
такие изменения требуют review policy до release, source-bound harness не заменяет его.
Regression: `runtime policy rejects unrelated expired and altered advisory exceptions`.

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
