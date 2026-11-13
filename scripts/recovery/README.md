# Recovery drill

`pnpm recovery:drill` последовательно выполняет test:prepare, четыре integration
suites с реальным PostgreSQL/compiled CLI/child processes, затем monitoring gate.
[Вход, роли, сценарии, результаты и ограничения](../../docs/runbooks/recovery-drill.md).
Raw Jest JSON живёт только в временном каталоге; публичный JSON содержит только
имена/status/duration тестов. Accepted evidence перезаписывается только при успехе.
Fault hooks остаются в tests, рабочая .env и dev volumes не меняются.

JSON schemaVersion=1: startedAt/finishedAt — UTC всего запуска; sloApproval — область согласования dev-only; tests — name/status/durationMs. Время теста включает fixture/assertions и не называется MTTR. Monitoring assertions подтверждаются успешным завершением второго шага; сырые Prometheus/Loki ответы в JSON не копируются.

Accepted JSON публикуется через общий atomic writer: write/EIO/rename failure сохраняет предыдущий файл. Два output-файла не являются общей filesystem transaction.
