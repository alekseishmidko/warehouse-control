# Рефакторинг читаемости и повторов

## Границы до реализации

Просмотрены read services, shared pagination, SQL pagination adapter, бизнес-владельцы
и правила shared. Повторное формирование фильтров найдено в восьми read сценариях
receiving/inventory/fulfillment/audit. Длинный cursor parser смешивает decoding,
проверку структуры и timestamp. Рабочая WMS-501 остаётся в workspace без изменений.

Вход: валидированный HTTP DTO и warehouse ACL в borrowed context. Успех: прежние
DTO/SQL/cursor scope; ошибки VALIDATION_FAILED не меняются. Read не создаёт stock,
аудит или outbox; транзакции и auth остаются у caller. Новых бизнес-решений нет.

| AC         | Результат                                                                       | Проверка                                    |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| RF-READ-01 | Optional filters обрабатываются один раз; одинаковый scope для absent/undefined | keyset-page unit + реальные warehouse-reads |
| RF-READ-02 | UUID нормализованы без мутации DTO; whitelist фильтров виден в каждом сервисе   | unit и integration всех read consumers      |
| RF-READ-03 | Cursor decode/shape/time разделены; SQL microseconds и прежние ошибки сохранены | keyset-page unit + PostgreSQL pagination    |
| RF-READ-04 | Комментарии объясняют scope, SQL continuation, read transaction и ACL границы   | review + check:pr                           |

Это законченный рефактор общей read capability, не массовое переписывание каждого
файла проекта. Похожие SQL бизнес-сценарии не объединяются generic repository.

## Frontend и соседние пути

Просмотрены CommandJournal, Query keys/transport и gate wrappers. Запрет нового key
после неизвестного результата сохранён. Storage I/O отделён от pure validation;
метаданные PendingCommand описаны по назначению, UUID проверяются без coercion.
Существовавший Partial cast позволял [UUID] пройти regex как строке. Это воспроизведённый
P2 на недоверенной локальной записи, не подтверждённый обход server ACL.
Новые три regression tests (warehouseId/key/correlationId) падают до исправления,
после него read=null, send запрещён, fetch не вызывается, исходная запись не удаляется.

RF-WEB-01: parser не доверяет TS type assertion; проверка — journal.test.ts:
`storage UUID %s must be a string; array coercion never reaches fetch`.
Остальные проверки replay/lost response/408/401 остаются действующими.
CLI wrappers не объединены из-за различий timeout/cleanup/privacy contracts.
Проекцию allocation просмотрели, но изменение stock state rules в этот refactor не входит.

## Проверки до общего gate

- `pnpm --filter @warehouse/backend test:prepare`: exit 0.
- `pnpm --filter @warehouse/backend exec jest --runInBand --runTestsByPath .test-dist/test/unit/keyset-page.spec.js .test-dist/test/integration/warehouse-reads.spec.js .test-dist/test/integration/directory-reads.spec.js .test-dist/test/integration/warehouse-read-plans.spec.js`: 40/40, четыре suites, exit 0.
- `pnpm test:web`: red — три новых случая failed; green — 54/54 и web baseline без регрессий.
- `pnpm typecheck`: exit 0. Lint до frontend refactor прошёл, полный повтор — check:pr.

Логи: /tmp/readability-{prepare,focused,web-red,web-green,typecheck}.log.
Финальный check:pr и повторное ревью выполнены; результаты ниже. Coverage baselines не снижены.

Первый общий gate остановился на web coverage: 44 assertions passed, но journal
statements/branches оказались ниже 95%. Промежуточное сообщение о green не учитывало
coverage exit; этот результат не принят. Добавлены реальные негативные storage cases:
oversized body, неверный label, null/array body, credentials, чужой user и версия.
Повторный `pnpm test:web` — exit 0, 54 tests и baseline без регрессий. Thresholds
и coverage baseline не менялись. Полный gate повторяется на итоговом состоянии.

В следующем общем gate 636 backend tests passed, но SQL adapter branches стали
93,75% при baseline94,11% после изменения числа ветвей. Непокрыта ветка отказа
cursor с корректным scope, но неправильным видом ключа (time vs UUID-only).
Добавлен реальный HTTP/PostgreSQL regression в warehouse-reads.spec.ts:
`valid cursor scope cannot substitute UUID-only and timestamp SQL key kinds`.
Он проверяет обе стороны mismatch и успешное последующее чтение. Порог не снижен.

## Итоговое ревью и evidence

Проверены все восемь изменённых read методов, их repositories/DTO и общие consumers
catalog/warehouses; SQL continuation, key kind и микросекунды; CommandJournal storage,
execute/send/dispatch и ошибки неизвестного результата. Новых подтверждённых дефектов
в этих путях не осталось. Domain handlers, locks, stock/allocations и commit semantics
не менялись. Отсутствие мутации DTO подтверждено review конструкций копирования;
реальные SQL фильтры/ACL/paging проверены integration. Проверка frozen filters есть в unit.

| AC         | Код                                                               | Итоговое evidence                                                                                         |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| RF-READ-01 | shared/pagination/keyset-page.ts: preparePageRequest              | unit optional filters preserve existing cursor scope…; 637 backend tests passed                           |
| RF-READ-02 | 4 read services, 8 методов                                        | warehouse-reads: exact filters/foreign objects; directory-reads: revoked permission; review whitelist/DTO |
| RF-READ-03 | decodePagePosition/isCursorTimestamp + readKeysetPage             | unit malformed cursor/time; SQL same timestamps/microseconds; valid scope cannot substitute key kinds     |
| RF-READ-04 | JSDoc, pagination README и warehouse flow                         | review + lint/architecture/contracts/OpenAPI/build/Chromium/check:pr                                      |
| RF-WEB-01  | CommandJournal.read → parsePendingCommand/isUuidText/isJsonObject | red/green UUID arrays; credentials/oversize/scope; lost response/replay сохранены; 54 web tests passed    |

`pnpm check:pr` — exit 0 на итоговом коде: 637 tests / 49 backend suites,
54 web tests; оба baseline без регрессий (210 backend / 22 web файла).
Backend Jest/V8 statements/lines90,88%, branches94,65%, functions89,46%.
Web Vitest/V8 statements59,48%, lines64,47%, branches73,13%, functions53,90%.
Полный лог `/tmp/readability-check-pr.log`; focused key-kind `/tmp/readability-key-kind.log`
(14/14). Логи временные и могут быть удалены ОС.

Это не заявление о 100% coverage всего проекта. Browser evidence не включён в Vitest
coverage. Рефактор не проверяет production load/HA или полную матрицу браузеров.
Новые Kafka/Compose/image проверки не запускались: их source/config этим изменением
не менялись. Рабочие .env и volumes не затронуты; PostgreSQL fixtures disposable.
После успешного gate записаны только эти результаты и ссылки, formatter/diff check
выполнены отдельно. Применённые migrations, generated schemas и baselines не правились.
