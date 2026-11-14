# Локальный Schema Registry

Platform dependency WMS-502, отдельно от application chart и Strimzi. Apicurio3.3.4
с digest закреплён в compose.yaml. Только loopback HTTP; UI, внешний listener, credentials
и production auth не добавляются. In-memory storage теряется при пересоздании; Git
восстанавливает schemas, а business outbox/PG data сюда не переносятся.

## Запуск

`pnpm registry:up` запускает project wms-registry, port18081 и ждёт реальный REST readiness.
`WMS_SCHEMA_BASE=<accepted commit> pnpm registry:publish` публикует проверенные Git schemas; `pnpm registry:check` проверяет
точное содержимое/историю/rules, ничего не исправляя. `pnpm registry:down` удаляет только
данный Compose project. Root .env не читается; WMS_REGISTRY_PROJECT допускает только
wms-registry или wms-registry-<test UUID>. WMS_REGISTRY_PORT=0 выделяет свободный port;
WMS_REGISTRY_URL задаёт проверяемый локальный origin для публикации/check.

Основная проверка — `pnpm registry:gate`: отдельный UUID project/случайный port,
publish/check/repeat, сравнение remote schemas с Git и validation настоящим
consumer EventContracts, additive/breaking/unknown cases и cleanup в finally.
Это destructive тест только собственного in-memory Registry, не общего dev каталога.
Remote Docker endpoint и внешний Registry URL отклоняются до записи.

## Ограничения и диагностика

Compose limits:1CPU/1Gi; не HA, не storage/backup proof. HTTP anonymous допускает
изменение каталога другими локальными процессами; этот профиль не для внешнего стенда.
Не передавать токены в URL/argv, не публиковать реальные payload/credentials.
Диагностика: compose ps, readiness /apis/registry/v3/system/info и release check.
Ошибка rules/content drift блокирует producer release; не обходить local transitive guard. Server COMPATIBILITY=NONE выбран явно из-за
отсутствия native2020-12 compatibility; VALIDITY=FULL задан, но не заменяет local strict Ajv2020: server принял malformed
schema в spike. Release CLI/adapter проверяет её до любого write.
Partial publish требует повторного check и operator recovery по runbook.

[Владелец contract release](../../docs/flows/schema-release.md),
[код и команды](../../scripts/registry/README.md), [evidence](../../docs/reports/wms-502.md).

При восстановлении dev instance текущие schemas можно перепубликовать из Git,
но это не восстановит все historical revisions. Для release FULL_TRANSITIVE нужны
accepted history и baseline; не объявлять свежий пустой Registry доказательством
совместимости с потерянными revisions. Перед внешним стендом требуется persistent
storage/backup и ограниченный writer доступ либо иной проверенный native Registry.
