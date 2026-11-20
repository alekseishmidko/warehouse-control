# 0039. Минимальный Node runtime и адресные advisory exceptions

- Дата: 2026-11-20
- Статус: Accepted
- Уточняет: [ADR-0005](0005-platform.md), заменяет полный Node slim как runtime WMS-112/303.

## Контекст

Пользователь поручил обновить Node/Debian image, удалить npm и лишние инструменты,
разобрать оставшиеся advisory и повторить gates без публикации. Scan старого runtime
давал HIGH45/CRITICAL1/UNKNOWN12; часть findings принадлежала системным утилитам и npm.
Удаление tooling поверх прежнего base не удалило бы его bytes из нижних layers.

## Решение

Build/prod install используют Node24.22.3 trixie-slim с pinned multiarch digest.
Оба runtime начинаются с pinned distroless cc-debian13, получают только Node binary,
passwd/group (прежний node uid1000) и application artifacts. Npm/Corepack/Yarn/shell/
package manager не входят в исходные runtime layers. API/worker/migrate и web сохраняют
exec entrypoints, порты, uid1000, read-only rootfs и SIGTERM. Host dev не меняется.

Policy блокирует все HIGH/CRITICAL и новые UNKNOWN, включая unfixed. Только адресные
UNKNOWN для libc6/libssl3t64 допускаются по review до2026-12-20. Область:
CVE+package+version+severity+status+OS+base digest+Node. FixedVersion, новая severity,
обновление пакета/base/Node или истечение срока требуют нового review.

Runtime gate проверяет Node version, uid, отсутствие tooling/native addons, статическую
связь Node с OpenSSL и список загруженных shared libraries. Production source не
использует FFI/iconv/child_process. Node TextDecoder/Intl использует ICU, а не glibc
iconv. Gconv и системные SSL libraries **остаются в образе**: исключения утверждают
недостижимость через текущий JS-only runtime, не исправление библиотек.

## Альтернативы и последствия

Полный обновлённый slim сохраняет ненужные исполняемые утилиты. Alpine меняет libc и
усложняет совместимость; копирование отдельных библиотек без package metadata скрывает
их из scan. Distroless сохраняет Debian metadata для полного отчёта scanner.

Shell debugging внутри runtime отсутствует: пользоваться Node diagnostics/logs или
отдельным разрешённым debug-контейнером. Добавление native addons/FFI/внешних CLI
сначала требует пересмотра этих исключений; image gate не разрешит native .node файлы.
Сеть и credentials в runtime probes отсутствуют. Package metadata и полный scan JSON
не фильтруются; summary содержит waived entries и hash source policy.

## Проверки

`pnpm docker:image-check`, `pnpm docker:image-check --web`, `pnpm images:scan`,
`pnpm docker:gate`, полный harness. Содержание и границы exceptions:
[владелец policy](../../scripts/image-release/README.md),
[AC/review](../reports/wms-602.md). Первоначальная проверка не публиковала images; последующий разрешённый выпуск и целевой pull выполнены WMS-602, evidence находится в отчёте.

Источники: [distroless](https://github.com/GoogleContainerTools/distroless),
[Node Intl/ICU](https://nodejs.org/api/intl.html),
[официальные Node images](https://github.com/nodejs/docker-node).
