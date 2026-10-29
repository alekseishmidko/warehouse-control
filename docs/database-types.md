# Поля таблиц и выбор PostgreSQL-типов

Справочник для чтения собственных Drizzle schema-файлов. Назначение **каждой колонки**
и локальные нюансы находятся непосредственно над её определением; здесь собраны общие
свойства типов и границы гарантий. Эти комментарии не добавляют SQL COMMENT в саму БД,
не меняют DDL и не заменяют применённые миграции.

## Тип — не бизнес-правило

| Тип / конструкция                   | Почему используется                                                                   | Нюанс в этом проекте                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| uuid                                | Стабильные ссылки на документы, товары, события и субъектов независимо от бизнес-кода | UUID не доказывает существование, права или порядок создания. FK/сервис проверяют остальное. `defaultRandom()` означает генерацию в БД, отсутствие default — назначение сценарием                                                    |
| integer / int4                      | Штучные количества, позиции строк, attempts и HTTP status                             | Диапазон PostgreSQL от -2147483648 до 2147483647, все значения точны для JS number. Положительность/0..MAX задаёт CHECK. Дроби отклоняются на границе DTO; преобразования SQL сами по себе не заменяют эту валидацию                 |
| bigint / int8 с mode:number         | Длинные версии агрегатов и курсоры                                                    | SQL bigint шире точного диапазона JS number. CHECK ограничивает версии до Number.MAX_SAFE_INTEGER=9007199254740991. Сам mode:number этого не делает. Полный int8 потребовал бы другого представления в JS/JSON и изменения контракта |
| text                                | Бизнес-коды, статусы, логические имена, hash, диагностические коды                    | Нет автоматического ограничения длины или нормализации регистра. Формат/длина задаются CHECK, нормализация — сервисом. `length` считает символы, а не UTF-8 bytes; ограничение сообщения по bytes проверяется отдельно               |
| text + CHECK вместо PostgreSQL enum | Явный закрытый список значений рядом со схемой и остальными проверками                | Для расширения статусов нужна миграция CHECK и согласование сервисов/контрактов. TypeScript union/$type не создаёт enum/проверку в БД                                                                                                |
| jsonb                               | Разнородные безопасные audit changes, снимок события, сохранённый HTTP response       | Сохраняется структура, а не исходный текст: порядок ключей/пробелы/дубликаты ключей не сохраняются. Не следует сравнивать исходные JSON bytes с JSONB. Валидный JSON не означает валидный бизнес-контракт                            |
| timestamptz                         | Абсолютный момент создания, проведения, завершения и срока lease                      | Исходная зона/offset не сохраняется; представление при чтении зависит от TimeZone сессии. API нормализует время в UTC ISO. SQL поддерживает микросекунды, JS Date — миллисекунды; lease worker явно согласует точность               |
| boolean                             | Флаг факта маскирования audit changes                                                 | Флаг не хранит секрет и не доказывает правильность маскирования. NOT NULL + default false исключают третье, неопределённое состояние                                                                                                 |

`numeric` был бы вариантом для точного дробного количества, но текущий бизнес-контракт —
целые штуки. Переход на вес/дроби требует решения о масштабе, округлении и представлении
в JSON/JS вместе с миграцией. `real`/`double precision` не выбраны для складского количества
из-за двоичной приближённой арифметики; silently менять integer на float нельзя.

В JSONB `$type<T>()` — подсказка компилятору, а не runtime validator. События проверяет
EventContracts; аудит фильтрует AuditService; HTTP-result ограничивает HttpCommandsService.
Unknown optional fields события сохраняются, но диагностический preview выбирает только
разрешённые поля. Поддержка GIN у JSONB не означает, что такой индекс создан: без сценария
поиска по payload он добавлял бы стоимость каждой записи без подтверждённой пользы.

## Время, NULL и default

- `defaultNow()` использует SQL now()/CURRENT_TIMESTAMP — начало текущей транзакции,
  не clock_timestamp() на каждом вызове и не момент commit. Две записи могут иметь
  одинаковое время; сравнение timestamps не заменяет aggregateVersion/locks.
- Планирование available_at и проверка lease выполняются по часам PostgreSQL.
  Часы CLI/браузера не определяют, можно ли отобрать владение у worker.
- SQL NULL означает отсутствие: например draft ещё не имеет postedAt/postedEventId.
  Это осмысленное состояние, а не произвольный пропуск обязательного поля.
- JSONB `null` — JSON-значение, отличное от SQL NULL. У HTTP result SQL NULL всех
  result-полей означает pending, а JSON null в body может быть готовым ответом.
- PostgreSQL CHECK отклоняет false, но не SQL unknown/NULL. Поэтому нужны NOT NULL,
  явные ветки IS NULL/IS NOT NULL или coalesce(...,false) для JSON identity.
- UNIQUE по nullable postedEventId допускает несколько NULL в draft-документах;
  непустой идентификатор уже не может принадлежать двум приёмкам.
- Default задаёт значение при его отсутствии в INSERT, но не заменяет явный NULL
  и не делает колонку неизменяемой. Retention/immutable обеспечивают отдельные триггеры/права.

## Ключи, индексы и атомарность

PK/UNIQUE создают уникальные индексы и защищают гонки, а не только обычный последовательный
ввод. Но UUID PK не заменяет бизнес-ключ: у stock_balances отдельный UNIQUE
warehouse/location/product. У события отдельный UNIQUE aggregate/type/version, потому
что разные UUID ещё могут обозначать конкурирующие версии одного потока.

Составной FK проверяет совместное существование значений в **одной** строке источника:
warehouse+location, receipt+warehouse+location+event, receipt+line+product+quantity.
Два независимых FK подтвердили бы лишь существование каждого объекта, но не их связь.
Некоторые расширенные UNIQUE выглядят избыточно рядом с UUID PK, однако служат целями
таких составных FK. Nullable часть составной ссылки при стандартном MATCH SIMPLE может
исключить её из проверки — обязательность источника отдельно задаётся NOT NULL/состоянием.

FK не создаёт автоматически индекс на ссылающихся колонках. B-tree эффективен для
подходящих сравнений и порядка ключей; левый префикс составного индекса имеет значение.
Частичный индекс outbox available_at охватывает pending/retry/processing, не всю историю.
Наличие индекса само по себе не доказывает хороший query plan; EXPLAIN/нагрузка остаются
отдельной проверкой. Здесь не добавлены индексы только ради комментариев.

FK/UNIQUE/CHECK проверяют структуру/состояние, но не подтверждают права, атомарность разных
вызовов или exactly once. Бизнес-операция, audit, movement, outbox/HTTP result используют
один transaction context; worker effect/marker/cursors/completion — другой общий context.
Дефолтных каскадных удалений истории не добавлено. Политики immutable/retention и runtime
grants реализованы SQL-миграциями; DBA способен их обойти.

## Где читать конкретные поля

- [Технические метаданные](../apps/backend/src/infrastructure/database/schema.ts).
- [Товар](../apps/backend/src/modules/catalog/catalog.schema.ts) и
  [склад/ячейка](../apps/backend/src/modules/warehouses/warehouses.schema.ts).
- [Аудит](../apps/backend/src/modules/audit/audit.schema.ts).
- [Баланс/движение](../apps/backend/src/modules/inventory/inventory.schema.ts).
- [Приёмка/строки](../apps/backend/src/modules/receiving/receiving.schema.ts).
- [Задание размещения](../apps/backend/src/modules/inventory/putaway-task.schema.ts).
- [HTTP idempotency](../apps/backend/src/infrastructure/idempotency/idempotency.schema.ts).
- [Outbox](../apps/backend/src/infrastructure/outbox/outbox.schema.ts).
- [Маркеры/курсоры worker](../apps/backend/src/infrastructure/worker/worker.schema.ts).

Это справочник хранения, не новый сценарий исполнения. Флоу и commit/rollback:
[приёмка](receiving.md), [worker](flows/worker.md), [putaway](flows/putaway.md),
[восстановление outbox](flows/outbox-recovery.md). Схемы процессов там остаются владельцами
подробностей; документация полей не меняет их поведение.

Первичные источники PostgreSQL 17:
[числовые типы](https://www.postgresql.org/docs/17/datatype-numeric.html),
[дата/время](https://www.postgresql.org/docs/17/datatype-datetime.html),
[JSON/JSONB](https://www.postgresql.org/docs/17/datatype-json.html),
[ограничения и ключи](https://www.postgresql.org/docs/17/ddl-constraints.html).

## Identity schemas WMS-202

Одна таблица — один файл в [identity/schemas](../apps/backend/src/modules/identity/schemas/users.schema.ts):
users, sessions, warehouse_roles, auth_login_windows и identity_bootstrap. В них подробнее
описаны UUID vs capability, password hash vs token digest, отсутствие default TTL,
nullable revoked_at, deadline CHECK, составные grants и retained one-time marker.
Карта всех файлов — [README identity](../apps/backend/src/modules/identity/README.md#schemas-одна-таблица-один-файл).
Суммарно в backend 23 таблицы/15 собственных schema-файлов; разбиение не меняет DDL.

WMS-203 сохраняет 23 таблицы/int4. В task добавлены четыре nullable completion поля
(UUID/timestamptz), CHECK связывает их с pending/completed. В movements nullable UUID
transferId (receipt NULL), CHECK направления и UNIQUE(transferId,kind); signed quantity не введено.
Исходные schema comments и ADR-0021 объясняют FK/state/deferred guards и сохранение creation audit.
