# 0028. Kubernetes release и сериализация migrations

- Дата: 2026-11-06
- Статус: Accepted
- Уточняет ADR-0005: application Helm chart и отдельные platform dependencies.
  Сохраняет ADR-0008/0009 и все business transaction/inventory boundaries.

## Контекст и решение

WMS-302 вводит API/worker Deployments с одним image digest, разными entrypoints и
отдельным pre-install/pre-upgrade migration Job. Kubernetes не гарантирует
однократный запуск Pod. Helm revision идентифицирует Job, Drizzle journal исключает
повтор применённого SQL, PostgreSQL session advisory lock сериализует все штатные
CLI/releases одной БД до journal lookup. Migrator и lock используют один client.
Соединение уничтожается в finally; lock не возвращается в pool. Ожидание lock 120s,
Job deadline 180s, без SQL auto retry. Имена lock key — protocol, не business rule.

Secrets runtime/migration существуют до Helm install. Credentials и DB provisioning
не включены в release. Runtime login не получает ownership/DDL; service accounts не
получают Kubernetes API token/RBAC. PostgreSQL/PVC управляются отдельной local platform
конфигурацией; приложение не владеет жизненным циклом данных.

## Альтернативы и последствия

Миграция в startup каждого Pod создала бы лишние callers и неоднозначный rollout.
Один Helm Job без DB lock не защищает разные releases или host CLI. Kubernetes Lease
не обеспечивает синхронизацию с внешним DB migrator. Поэтому lock находится в БД.
Advisory protocol не защищает от DBA/старого executable в обход него.

Pre-upgrade применяет только expand, совместимый со старым image. Contract требует
отдельного release после удаления старых consumers и backfill/replay. Helm rollback
не откатывает SQL. Hook resources сохраняются для диагностики и очищаются отдельно.
Ошибки hook блокируют применение новых Deployments. WMS-303/304 остаются отдельными.

[Flow, ошибки и tests](../flows/kubernetes-app.md), [AC/evidence](../reports/wms-302.md).
