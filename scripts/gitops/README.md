# GitOps и release/recovery rehearsal

Бизнес-цель — доказать установку, выпуск, откат приложения и восстановление синтетического
склада без изменений рабочего стенда. Оператор должен иметь доступ к локальному Docker,
Git, Node/pnpm и публичным pinned release assets/GHCR. Авторизация ограничена новым kind.
Входу source chart/lock/task доверяем после review; mutable image/revision не допускаются.
[Полный flow и отказные ветви](../../docs/flows/gitops-release-recovery.md).

```sh
pnpm gitops:gate
pnpm release:drill
pnpm harness:plan docs/tasks/wms-604.json
pnpm harness:run docs/tasks/wms-604.json
pnpm harness:ready docs/tasks/wms-604.json
```

На macOS долгую команду можно обернуть `caffeinate -i` для предотвращения idle sleep.
Это не меняет deadlines или системные настройки. Не запускать эти команды одновременно
с check:pr/coverage/test:prepare: они используют общие compiled outputs и Docker VM.
Playwright Chromium нужен для полного check:pr, устанавливается штатной командой.

`gitops:gate` проверяет только WMS-603. `release:drill` сначала запускает реальные
PostgreSQL/Kafka cutover tests, затем повторяет WMS-603 в новом kind и добавляет WMS-604.
Обе команды destructive только для своих temporary resources. Никаких push/deploy
внешнего окружения или чтения рабочей .env нет. Выход0 включает готовность сервисов
и cleanup; создание процесса само по себе не считается успешным запуском.

`WMS_GITOPS_TOOLS` выбирает доверенный private cache инструментов (по умолчанию
artifacts/gitops-tools/OS-arch). SHA bytes проверяется при каждом запуске; cache directory
не должен изменяться другим пользователем во время выполнения. `WMS_KIND`/`WMS_KUBECTL`
— явные operator overrides для диагностики, им доверяет оператор. В обычном run нужны
pinned binaries. Версии/hashes — [toolchain](../../infra/gitops/README.md).

## Ответственность модулей

`tools` проверяет и устанавливает CLI; `session` владеет cluster/context/private files,
bounded commands и finally cleanup. `core` устанавливает vendor Core и AppProject;
`import` переносит только выбранную platform и проверяет config identity. `registry`
сверяет исторический GHCR access probe с WMS-602; `baseline` заново строит/сканирует
текущий runtime и импортирует только checked config. `secrets` шифрует/восстанавливает ключ и применяет
Secrets через stdin. `source` создаёт отдельный whitelist Git/ClusterIP server;
`platform` создаёт DB/roles и values. `application` ожидает сравнение revision, запускает
одну явную sync operation, наблюдает результат и rollout. `rehearsal` связывает эти
шаги с SQL failure/drift; `gate` — CLI entry point.

`business` вызывает production seed/bootstrap owners, затем реальные session/CSRF HTTP
команды отдельным непривилегированным client Pod. `load` поддерживает ограниченный поток
реальных receipt create/post во время rollout. `runtime-source` фиксирует build-input digest (untracked включены, ignored запрещены)
и отклоняет изменения после fresh checked build;
`release` координирует совместимый выпуск,
image rollback и failed migration; `forward-fix` проверяет committed несовместимость.
`backup` выполняет freeze/dump/encryption/restore/validation/promotion; `transport-proof`
проверяет отдельный real Kafka drill до consumers resume. `release-drill` — полный CLI.
Общий temporary-image builder находится в image-release/fixtures.cjs.

## Результат, ошибки и тесты

Выход0 требует каждого assertion и cleanup. SQL hook failure ожидается только в явно
отказной фазе: DDL/journal не меняются и старый workload остаётся. Committed incompatible
schema отдельно даёт HTTP500; rollback image сохраняет проблему, новая migration её
исправляет. Неизвестный HTTP результат автоматически не повторяется. Backup проходит
wrong-key/corruption negatives, сравнение data/schema/journal/sequences и runtime grants.

Program-generated summaries: artifacts/gitops-gate/evidence.json и
artifacts/release-drill/evidence.json. `status`, UTC times, sourceCommit/sourceSnapshot,
cluster/architecture, Git revisions, localBaseline build/scan/config binding, digests/config IDs и безопасные proof fields
позволяют связать run с source. Release summary добавляет transport test counts/times,
business amounts, rolling request counts, telemetry hash, rollback/forward-fix,
restored table counts/hashes и checklist. Это не секреты и не raw customer data.
Private api/load/cutover logs mode0600 не публикуются workflow. Keys/decoded Secrets,
cookies и plaintext dump не пишутся в accepted summaries. Private temp directory
удаляется с cluster, включая key backup и encrypted dump; постоянный escrow не обещается.

Native regression: `pnpm test:pr-checks` (real Helm render, policy negatives, config binding,
cleanup ownership, фактический ESM load program). Live команды выше проверяют реальные
Argo/Kubernetes/PostgreSQL/HTTP; `pnpm cutover:drill` — Kafka. Эти CLI/Pod scripts не
входят в Jest backend/web coverage; успешный run не означает100% их branches.
После SIGKILL проверить только cluster с UUID из evidence и private directory этого run;
не удалять чужие clusters/volumes/images и не применять Docker-wide prune.
