# Восстановление обработки событий

Проверенный локальный runbook WMS-111. Команды inspect/retry/signal реализованы;
реальная CLI последовательность проверена в disposable PostgreSQL. Не выполнять
произвольные SQL reset/update, не менять eventId/envelope/markers/cursors/tasks.
[Подробный flow](../flows/outbox-recovery.md), [модель прав](../adr/0017-local-outbox-recovery.md).

## Для менеджера

Зафиксировать receipt/eventId, время и correlationId; не проводить приёмку повторно ради
ремонта очереди. Подтверждённые stock/movement сохраняются при ошибке фонового handler.
Delivery completed + task pending означает успешное создание задания и ожидание физического
размещения, а не отказ доставки. Оператор сообщает причину, затронутый stream и итог проверки.

## Безопасная воспроизводимая тренировка

Из корня репозитория, с доступным Docker и установленными workspace dependencies:

```sh
pnpm outbox:recovery-check
```

Команда выполняет build/contracts/OpenAPI checks и integration recovery suite. Создаёт
собственный PostgreSQL, применяет настоящие migrations, создаёт posted receipt через
production owners, вводит временный test-only SQL fault после task INSERT и получает dead.
Затем удаляет fault и вызывает **настоящий compiled CLI** inspect → signal → retry → worker
→ inspect/signal. Проверяется одна task/marker/movement/event, stock=10, operator/reason audit
и сохранение attempts. После тестов контейнер/pools закрываются; dev Compose и его volume
не меняются. Production handler не имеет fault flag. Нормальный результат — passed suite,
никакого Docker skip/fallback. Число cases растёт вместе с safety tests, см. [отчёт](../reports/wms-111.md).

## Условия ручного локального запуска

Перед использованием текущей локальной БД: `pnpm db:migrate`, `pnpm build`.
Требуются PostgreSQL 17 и migrations 0016/0017, отдельный worker/API уже используют эту БД.
В ignored .env настроен loopback DATABASE_URL; URL с credentials не передавать флагом.
CLI требует explicit NODE_ENV development/test, OUTBOX_ADMIN_ENABLED=true и loopback DB host.
Для обычного запуска опция выключена. DB login должен иметь warehouse_outbox_admin role
с нужными grants; dev migration owner/superuser также проходит. CLI не создаёт login и
не аутентифицирует человека по operator UUID. Remote production admin API не реализован.

```sh
export NODE_ENV=development
export OUTBOX_ADMIN_ENABLED=true
WMS_EVENT_ID='<postedEventId из ответа проведения>'
WMS_OPERATOR_ID='dbb37b21-1c4a-4b32-9307-148df1647f4c'
```

UUID оператора в примере синтетический; для локальной практики выбрать свой постоянный
UUID и указывать его явно. Это утверждённый локальным вызывающим субъект, не проверка
пользовательского каталога. Не включать этот режим на внешнем стенде; provisioning credentials
и authenticated production RBAC остаются отдельными задачами.

## 1. Найти состояние и ограничить масштаб

```sh
pnpm outbox:inspect --event "$WMS_EVENT_ID" --consumer inventory.putaway
pnpm outbox:inspect --event "$WMS_EVENT_ID" --consumer inventory.putaway --payload
pnpm outbox:signal
```

Inspect показывает eventId, source correlationId, stream/type/id/version, consumer,
общий attempt, lastError, status, обе lease даты/active flags, cursors и processed marker.
Последние 20 recovery records включают прежние attempts/base/error, operator/reason и auditId.
Payload по умолчанию omitted; --payload показывает только проверенные UUID/quantity первых
10 lines и lineCount/truncated. Unknown optional fields исключены; invalid envelope redacted.
Raw error/stack/SQL/token/credentials не печатаются. Не считать inspect блокировкой worker.

Signal defaults: dead>=1 либо active backlog>=100 либо oldest active backlog>=60s → alert.
Backlog=pending/retry/processing; dead отдельный count. BlockedStreams показывает next-version
потоки с dead, expiredProcessing — кандидаты автоматического lease recovery.
Можно явно задать `--dead-limit 1 --backlog-limit 100 --max-age-seconds 60`.
Node executable возвращает 0 healthy, 2 alert, 1 denial/failure. pnpm добавляет свои banners;
для machine-readable одного JSON и точных exit codes использовать после build:

```sh
node apps/backend/dist/infrastructure/outbox/outbox-admin.js signal
```

Команда использует тот же env guard. Внешние каналы/уведомления не вызываются и не
настроены этим этапом. Pino/Loki/метрики и alert routing — WMS-401/402.

## 2. Устранить причину до retry

- Для transient dependency/DB failure восстановить доступность.
- Для ошибочного handler/schema support исправить код и перезапустить нужный worker.
- Для source FK/semantic конфликтов изучить receipt → event → task через
  [read-only putaway SQL](../examples/putaway-result.sql). Не исправлять immutable fact руками.
- Processing с expired lease восстанавливает сам worker, это не dead retry.
- Completed/processed marker не повторять; не удалять task/marker ради «чистого» прогона.

Runbook тренировки устраняет причину удалением fault только внутри disposable fixture.
В пользовательской dev БД такой failure injection CLI не существует. Неисправленная причина
снова даст dead — сам retry не делает неправильный event корректным.

## 3. Выполнить ровно один адресный retry

```sh
pnpm outbox:retry --event "$WMS_EVENT_ID" --consumer inventory.putaway \
  --operator "$WMS_OPERATOR_ID" --reason dependency-restored
```

Reason — технический code до 96 символов, например handler-fixed/schema-support-added;
не свободный текст с токенами, персональными данными или описанием инцидента.
Команда требует dead, неактивные leases и отсутствие locks работающего handler (NOWAIT).
Оба cursors должны быть version-1, marker отсутствовать; обход предыдущего event запрещён.
Retry не вызывает handler. В одной transaction сохраняются AuditService entry и immutable
recovery record, ставится retry/available now и budget base=текущие attempts. EventId/envelope,
общие attempts, last_error, tasks, markers/cursors сохраняются. Новый worker claim увеличит
общие attempts, но начнёт новый ограниченный бюджет; прежняя ошибка останется в history.

Ответ содержит committed recoveryId/auditId, operator/reason, administrationCorrelationId.
Исходный correlationId event не заменяется. При потере ответа сначала inspect: повтор той же
команды на уже retry/processing/completed будет отклонён, новая история не создаётся автоматически.

| Code | Действие |
|---|---|
| LOCAL_ACCESS_REQUIRED / ADMIN_ROLE_REQUIRED | Проверить локальный режим и DB membership; не обходить guard |
| DELIVERY_NOT_FOUND / INVALID_ARGUMENTS | Проверить UUID и consumer, не выбирать другой event наугад |
| DELIVERY_BUSY / LEASE_ACTIVE | Дождаться штатного завершения/автоматического lease recovery |
| NOT_DEAD | Processing/retry/pending не являются целью административного dead retry |
| PREDECESSOR_REQUIRED | Устранить предыдущую ошибку потока, не продвигать cursors вручную |
| ALREADY_PROCESSED | Исследовать состояние, не сбрасывать marker/task |
| ATTEMPT_LIMIT_REACHED | Требуется отдельное решение по исчерпанному int4 counter, reset не предлагается |

## 4. Проверить итог

Worker должен работать отдельным процессом: `pnpm worker`. Далее повторить inspect/signal.
Ожидание для демонстрационной одной строки: delivery completed, оба cursors=1, marker=true,
attempt 2, recovery history с прежним attempt 1; task pending, stock=10/reserved=0,
movement/event/task по одному. Наличие task проверяется [putaway-result.sql](../examples/putaway-result.sql).
Alert исчезает при отсутствии других dead/старого backlog; другой поток может требовать
отдельного расследования. После локального обслуживания выключить OUTBOX_ADMIN_ENABLED.

## Будущие replay и Kafka recovery

Replay/rebuild, массовый retry и внешние эффекты этой CLI не реализованы. Для них нужен
явный диапазон/consumer/start position и отдельный план, сохраняющий ordinary deduplication.
Kafka cutover остаётся проектным WMS-506: stop writers/workers → backup/boundary → явный
перенос незавершённых delivery с прежним eventId → проверка эффектов → открытие записи.
Не включать два транспортных пути одновременно, не считать rollback образа rollback данных.
