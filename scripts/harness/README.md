# Локальный engineering harness

Владелец подробного процесса: [постановка задачи → evidence → readiness](../../docs/flows/engineering-harness.md).
CLI не ставит складские задачи и не меняет приложение. Он исполняет закрытый каталог
существующих pnpm gates, привязывает результаты к input contents и отказывает при
missing/failed/stale evidence. Техническая готовность не является приёмкой пользователя.

Модули: policy.cjs проверяет task/AC и вычисляет gates; snapshot.cjs снимает hashes и
наблюдает writes; cli.cjs владеет child processes, lock, logs и readiness. Атомарная
запись используется из scripts/evidence/atomic-json.cjs, не копируется.

Команды из корня:

```sh
pnpm harness:plan docs/tasks/harness-runner.json
pnpm harness:run docs/tasks/harness-runner.json
pnpm harness:ready docs/tasks/harness-runner.json
pnpm test:harness
```

Source task описан в docs/tasks/README.md. Outputs — ignored artifacts/harness;
private logs0600 могут содержать вывод tools, их нельзя без проверки публиковать.
Unit/integration control tests используют настоящие временные Git repositories и
child processes. Минимальные fixture gates проверяют runner, не подменяют production
check:pr и не засчитываются как проверки приложения. Native fs.watch требует доступа
ОС; ошибка watcher запрещает passed/ready, sandbox fallback не включён.

WMS-601: frozen install запускается первым; pr и backend/web image checks обязательны
для каждого task. Root alias pr:pipeline вызывает этот же runner. Дополнительные gates
по-прежнему выбираются по diff/AC. [Полный flow](../../docs/flows/pr-pipeline.md).

GitOps/release изменения включают live gates автоматически: [policy/границы](../../docs/flows/engineering-harness.md), [команды](../gitops/README.md). Regression запрещает task с одним pr обходить эти gates.
