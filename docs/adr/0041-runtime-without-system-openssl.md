# 0041. Runtime без системных libssl/libcrypto

- Дата: 2026-11-23
- Статус: Accepted
- Уточняет [ADR-0039](0039-minimal-node-runtime.md), [ADR-0040](0040-local-gitops-release-recovery.md).

## Причина и решение

Fresh Trivy DB нашла HIGH CVE-2026-124709 в libssl3t64 старого cc-debian13 runtime.
Debian13 ещё не имеет fixed version. HIGH не получает waiver; scanner policy не меняется.
Официальный base-nossl-debian13 содержит glibc/CA без SSL. Новый pinned index:
sha256:4006ac92504be607b70de01d1f64f38288c69fcd8faa820f6d3aed266ea32ac5.
Оба Dockerfile используют его как runtime base.

Node24.22.3 остаётся прежним и использует bundled static OpenSSL. Системные libssl/
libcrypto ему не нужны. Нужны libstdc++6/libgcc-s1/gcc-14-base: общий helper переносит
их фактические файлы, SONAME links, licenses и package metadata из прежнего pinned cc
stage. SSL stage не входит в ancestry runtime; libssl bytes и её metadata не копируются.
Это удаление ненужного пакета, а не сокрытие установленной библиотеки от scanner.
Upstream Distroless уже исключает часть docs/debug files; helper сохраняет его inventory
и проверяет MD5 существующих package files. Доверие обеспечивает pinned source SHA,
MD5 здесь не является подписью. Arbitrary paths/SSL payload отвергаются.

Runtime probe проверяет отсутствие системных SSL files/package, tooling/native addons,
Node version/uid и sharedObjects. Bundled static OpenSSL в Node **остаётся**; приложение
использует HTTP/TCP и не запускает QUIC server. Новый native/QUIC consumer требует review.
Три UNKNOWN glibc iconv сохраняют exact waiver для2.41-12+deb13u5, Debian13.8, новогоbase,
Node24.22.3 до2026-12-20. Node TextDecoder/Intl использует ICU, iconv/native addons/FFI
в runtime отсутствуют. Старые шесть waiver больше не описывают текущую policy.

## Локальный baseline и поставка

Исторические WMS-602 GHCR digests не переписываются. Registry probe выполняет только
Node smoke по прежним checked config IDs и доказывает доступ; их WMS больше не развёртывается.
GitOps gate заново строит текущий backend/web, фиксирует runtime build-input digest,
сканирует exact bytes и импортирует checked config в kind. Values в временном Git
получают local platform digest и Never. Baseline image rollback относится к этому fresh
checked baseline. Внешней публикации обновлённых images нет; она потребует отдельного
разрешённого delivery. Это соответствует согласованной локальной репетиции.

Runtime input digest включает новые source files, игнорируемые build inputs отвергаются,
test-only files не участвуют. До/после build проверяется digest и полный task snapshot;
scan report/config/digest связываются с CRI. Старый local tag без fresh build не принимается.
Полный final harness повторяет и эти gates, и итоговый scan. Readiness раннего failed run
не восстанавливается изменением evidence.

Источники: [Distroless base-nossl](https://github.com/GoogleContainerTools/distroless/blob/main/base/README.md),
[cc packages](https://github.com/GoogleContainerTools/distroless/blob/main/cc/README.md),
[Debian CVE-2026-124709](https://security-tracker.debian.org/tracker/CVE-2026-124709).
[Flow](../flows/gitops-release-recovery.md), [image policy](../../scripts/image-release/README.md).
