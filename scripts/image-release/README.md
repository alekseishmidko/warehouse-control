# Локальная проверка runtime images — WMS-602

Независимая подготовка поставки: скрипт не обращается к целевому registry и не публикует
images. Владелец подробного процесса — [image scan flow](../../docs/flows/image-scan.md).
Пользователь подтвердил подготовку GitHub Actions/GHCR без публикации. Доступы и целевой cluster ещё не проверены.

`scan.cjs` использует Docker CLI и Trivy 0.76.2, создаёт private UUID-каталог
artifacts/image-scan и удаляет экспортированный tar в finally. Общий atomic-json
writer принадлежит scripts/evidence; второй writer здесь не создаётся.
Source task JSON docs/tasks/wms-602.json описывает подготовку без внешнего запуска,
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
reason и ссылку на первичный источник. Все пять записей истекают2026-12-20 UTC.
Нет wildcard, исключений HIGH/CRITICAL или общего ignore-unfixed. Найденная FixedVersion,
новая severity/status/package version/OS или отсутствие runtime proof запрещают waiver.
Просрочка/дубликаты/невалидная source policy блокируют весь gate даже при чистом scan.

| Advisory                                                                       | Область                    | Причина применимости исключения                                                                      |
| ------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| [CVE-2026-121757](https://security-tracker.debian.org/tracker/CVE-2026-121757) | libc6 2.41-12+deb13u4      | CP949 через glibc iconv с контролируемыми input/encoding и //IGNORE; Node ICU не вызывает этот путь. |
| [CVE-2026-121758](https://security-tracker.debian.org/tracker/CVE-2026-121758) | тот же libc6               | ISO-2022-CN-EXT decoder glibc iconv; та же недостижимость.                                           |
| [CVE-2026-124024](https://security-tracker.debian.org/tracker/CVE-2026-124024) | тот же libc6               | UCS-4 → IBM1390/1399 glibc iconv с контролируемым memory layout; та же недостижимость.               |
| [CVE-2026-84786](https://security-tracker.debian.org/tracker/CVE-2026-84786)   | libssl3t64 3.5.7-1~deb13u3 | DANE системного OpenSSL; Node статически использует собственный OpenSSL3.5.9.                        |
| [CVE-2026-95690](https://security-tracker.debian.org/tracker/CVE-2026-95690)   | тот же libssl3t64          | DTLS системного OpenSSL; та же недостижимость.                                                       |

Gconv/libssl остаются в filesystem и полном JSON. Это не утверждение об исправлении
библиотек. Review production source не выявило FFI/iconv/child_process. Runtime probe
подтверждает отсутствие iconv/openssl CLI, .node addons и shared libssl/libcrypto.
Остаточный риск: новый JS/native consumer или внешние mounts могут изменить применимость;
такие изменения требуют review policy до release, source-bound harness не заменяет его.
Regression: `runtime policy rejects unrelated expired and altered advisory exceptions`.
