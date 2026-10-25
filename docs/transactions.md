# Транзакции и аудит WMS-103

Документ описывает сервисы, общий transaction port, владение транзакциями,
маскирование аудита и ограничения прав. Внутреннее stock начисление WMS-104 реализовано; outbox writer WMS-106 реализован; документы приёмки ещё нет.

## Для менеджера

Подтверждённое изменение и его история должны появляться вместе. Если запись истории
не удалась, изменение откатывается. Исправления не переписывают журнал: создаётся
новая операция с основанием. Атомарность проверена на metadata и реальном WMS-104 начислении stock;
полный документ приёмки и последующие складские операции ещё запланированы.

Аудит фиксирует субъекта, действие, объект, время, основание и correlationId.
Произвольные комментарии, HTTP bodies, пароли и токены не записываются.
Защита append-only действует для runtime-роли; администратор БД способен её обойти.
Это не криптографическое доказательство и не защита от подделки факта доверенным приложением.

## Владельцы и направление зависимостей

- Сервис-владелец сценария начинает `TransactionRunner.run` один раз.
- Вызываемые сервисы получают тот же `TransactionContext` явно.
- Shared содержит только port/context, без NestJS, HTTP, Kafka и ORM.
- Repository вызывает `transactionClient(context)` для borrowed Drizzle handle.
- Audit module предоставляет `AuditService.write(context, input)`; его AuditRepository выполняет SQL.
- Repository и вызываемый AuditService не начинают run, не создают второй pool и не коммитят отдельно.

Nest: TRANSACTION_RUNNER экспортируется DatabaseModule, AuditService — AuditModule.
Оба модуля подключены в AppModule. Пошаговое движение DTO и sequence diagram
приведены в [README audit](../apps/backend/src/modules/audit/README.md). Полный рабочий пример с передачей context между
тестовым interface и audit — `test/integration/transactions-audit.spec.ts`.

```ts
await transactions.run(async context => {
  await businessModule.change(context, command);
  await audit.write(context, auditInput);
});
```

Пример показывает композицию; businessModule — будущий сервис,
а не существующий endpoint. Ошибки обязательного audit нельзя перехватывать и игнорировать.

## Реализованные гарантии context

Один run создаёт одну PostgreSQL read committed transaction. Успешный callback
позволяет commit, исключение приводит к rollback. Все операции внутри callback
обязаны быть awaited. Fire-and-forget, callbacks таймеров и сохранение context
для последующей фоновой обработки запрещены.

Контекст — непрозрачная capability. WeakMap хранит binding к Drizzle transaction,
AsyncLocalStorage проверяет execution scope. После callback binding удаляется,
как при успехе, так и при исключении. Поддельный/завершённый/чужой context отклоняется.
Нельзя сериализовать и передавать его через HTTP/Kafka: после сериализации capability теряется.

Nested run запрещён, включая другой экземпляр runner в том же scope.
Savepoints через этот port не поддерживаются. Независимые корневые вызовы допускают
конкурентное выполнение. Прямой db.transaction остаётся техническим инструментом
migrations/test cleanup; прикладные write-сценарии обязаны пользоваться port.
Это правило не защищает от намеренного обхода адаптером через сырой SQL.

Утечку не-awaited Promise невозможно полностью устранить типовым контрактом:
это обязательное правило review. Callback не возвращает живой query builder или DB client.
Не делать сетевых запросов, публикаций и работы с внешними файлами внутри транзакции.
OutboxService.append получает тот же context, публикация будет выполняться после commit
будущим worker. Writer не делает самостоятельный commit и не начинает run.

## Retry policy

**Сейчас автоматического retry нет:** run выполняет callback ровно один раз,
ошибка с исходным SQLSTATE/cause передаётся владельцу сценария.

Правила для будущей явно включаемой политики:

1. Только `40001` serialization_failure и `40P01` deadlock_detected допускают
   ограниченный повтор всей транзакции после подтверждённого rollback.
2. Максимум три попытки суммарно, с jitter/backoff вне открытой транзакции;
   конкретные интервалы задаются при реализации, а не считаются уже работающими.
3. На каждой попытке новый context и повтор всех чтений/проверок. Повтор одного
   упавшего SQL в abort-состоянии запрещён.
4. Callback должен быть replay-safe и выполнять только транзакционные DB-эффекты.
   Стабильные command/correlation IDs формируются снаружи; HTTP idempotency ещё WMS-107.
5. Validation, access denied, unique violation и бизнес-конфликты автоматически не повторять.
6. Потеря соединения/ответа commit означает возможный неизвестный исход, а не доказанный
   rollback. Нельзя автоматически повторять по тексту ошибки или любому 08xxx.

Тесты инъецируют PostgreSQL SQLSTATE 40001/40P01 и проверяют отсутствие скрытого retry;
это не нагрузочный тест реальной deadlock race.

## Audit data policy

Обязательны actorType (`user`/`system`), actorId UUID, action code, entityType code,
entityId UUID, correlationId UUID и reasonCode. Код — lowercase технический идентификатор
до 96 символов, а не свободный текст. Коды задаются кодом модуля; формат проверяется,
общего реестра всех action/reason пока нет. Нельзя подставлять в них пользовательские значения.
actor берётся из доверенного application context, не из body будущего запроса.

id генерируется PostgreSQL, occurredAt — timestamptz default now(), то есть время
начала транзакции; пользователь не может подменить его через write interface.

Allowlist changes:

| Поля | Допустимые before/after |
|---|---|
| status | draft, posted, active, consumed, released или null |
| quantity, onHand, reserved | Целое 0..2147483647 или null |
| warehouseId, locationId, productId | UUID или null |

Другие поля и небезопасные scalar удаляются, включая их неизвестные имена.
`hasRedactedChanges=true` сообщает о фильтрации без сохранения исходных секретов.
Неизвестные вложенные поля не копируются. Неверные обязательные поля приводят
к безопасной validation error без вывода значения и откату операции.
Расширять allowlist нужно явно с тестами и обновлением документации.
Эта политика реализована AuditService; прямой доверенный SQL INSERT может её обойти,
поэтому бизнес-модули не получают право писать в audit в обход interface.

## Роли, migrations и ограничения

0001 добавляет audit_entries, constraints и индексы. 0002 — авторская custom SQL
migration для permissions/function/trigger. Старый baseline 0000 не изменён.

Группа `warehouse_app` — NOLOGIN без superuser/createdb/createrole/replication/bypassrls.
Миграция создаёт её либо проверяет существующую группу, не принимая привилегированную
роль с тем же именем. На audit она получает только SELECT/INSERT, не UPDATE/DELETE/TRUNCATE.
На metadata — обычный DML для текущего технического сценария; будущие таблицы требуют
явных grants в своих migrations. Не выдаются TRIGGER/ownership/schema CREATE.

Триггер блокирует UPDATE, DELETE и TRUNCATE даже при обычном SQL владельца таблицы.
DBA/owner могут отключить/удалить триггер или изменить права. Runtime login должен
быть отдельным непривилегированным пользователем, не владельцем таблиц, с membership
в warehouse_app. Provisioning его credentials выполняется вне versioned schema migrations.

**Текущий Compose всё ещё использует dev-admin connection**; добавление группы
не превращает его в production runtime login. Тесты используют SET LOCAL ROLE warehouse_app
для проверки grants и отдельно проверяют защиту обычного SQL владельца.
На внешнем стенде нельзя использовать dev-admin URL или считать SET ROLE от admin
защитой от намеренного RESET ROLE. Login provisioning внешнего стенда ещё не реализован.

Custom migration требует CREATEROLE или заранее подготовленную безопасную группу;
функция/таблица создаются migration owner. Нет автоматического удаления audit при rollback.
Dev migration применяется явной командой `pnpm db:migrate`, не HTTP startup.

## Проверки

`pnpm test:unit`, `pnpm test:integration`, `pnpm test`, `pnpm typecheck`.
Тесты доказывают совместный commit, отсутствие промежуточной видимости, rollback
до/после audit, scope revocation, запрет nested run, redaction и права роли.
Admin reset disposable harness отключает trigger и очищает таблицы в отдельной
транзакции, затем включает его обратно. Это test-only обход DBA, не runtime-возможность.

Источники: [Drizzle transactions](https://orm.drizzle.team/docs/transactions),
[PostgreSQL SQLSTATE](https://www.postgresql.org/docs/17/errcodes-appendix.html),
[PostgreSQL triggers](https://www.postgresql.org/docs/17/sql-createtrigger.html).


## HTTP command owner WMS-107

HttpCommandsService.execute владеет transaction для HTTP сценария и передаёт callback
тот же context. Claim idempotency/result и business/audit/outbox коммитятся вместе,
вложенный run не нужен. При replay callback не запускается. Авторизация выполняется
до dedup на каждом HTTP запросе, business state проверяется в callback. Ошибки не
кешируются; сетевой timeout не означает отменённую DB транзакцию. После неизвестного
исхода commit повтор с исходным key разрешает replay, новый key может повторить эффект.
Подробнее — [storage protocol](../apps/backend/src/infrastructure/idempotency/README.md).


## Worker owner WMS-109

WorkerService владеет отдельными короткими claim и failure runs и run обработки.
Локальный handler заимствует processing context, все эффекты awaited, без внешнего I/O.
Effect/marker/consumer cursor/transport cursor/completion фиксируются одной transaction.
Повтор доставки после rollback — явный backoff/budget протокол, не изменение runner
и не automatic retry HTTP command. Потеря commit ack разрешается состоянием delivery
и marker; stale token не имеет права переписать результат. Worker-only transaction_timeout
PostgreSQL 17 ограничивает весь processing run. [Контракт](../apps/backend/src/infrastructure/worker/README.md).
