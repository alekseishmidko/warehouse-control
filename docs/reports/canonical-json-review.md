# Ревью canonical-json

## Границы и требования до изменения

Владелец подтвердил область: указанный canonical-json.ts. Прямой потребитель —
HttpCommandsService; его request fingerprint и committed result/replay проверяются
для оценки последствий. Это не security-аудит всего проекта.

Вход request serializer — нормализованный plain JSON владельца команды, не DTO/ORM.
Snapshot serializer получает server-owned result. Session, warehouse ACL, stock и
SQL остаются ответственностью соответствующих модулей. Здесь нет бизнес-сущностей:
JSON value, текущая ветка ancestors и UTF-8 budget — технические структуры.

Подтверждён P2: budget проверяется после полного разворачивания повторных ссылок.
Объект из 18 уровней с общими потомками вызывает 393214 чтений descriptors перед
REQUEST_TOO_LARGE. Каждый следующий уровень удваивает работу. Лимит depth=64
не ограничивает ширину развёрнутого результата. Это проблема ресурсов публичной
внутренней функции; удалённая эксплуатация через существующий HTTP не доказана:
JSON parser не создаёт shared references. Произвольный исполняемый JS/Proxy не входит
в модель недоверенного HTTP JSON; encoder не является sandbox для чужого кода.

| AC    | Действие                                               | Ожидаемый результат                                             | Статус                       |
| ----- | ------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| CJ-01 | Повторные ссылки при request serialization             | Остановка при исчерпании 256 КиБ до полного разворачивания      | Пройдено: focused + check:pr |
| CJ-02 | JSON в пределах budget, keys/arrays, UTF-8/escaping    | Прежние байты и fingerprint; точная граница включительна        | Пройдено: focused + check:pr |
| CJ-03 | Snapshot >256 КиБ; invalid values/cycles/getters/depth | Большой snapshot сохранён целиком; общие JSON guards остаются   | Пройдено: focused + check:pr |
| CJ-04 | HTTP command + saved result/replay                     | Атомарность и replay сохранены, ACL не переносится в serializer | Пройдено: focused + check:pr |

Новые бизнес-решения, пагинация истории, proxy policy, migrations и dependencies
в эту работу не входят. Исправление не меняет valid wire representation и не
применяет request budget к server-owned snapshot.

## Исправление и повторное ревью

Request и snapshot используют один encoder. Request передаёт budget 262144 bytes;
append считает фактические UTF-8 bytes каждого фрагмента и отказывает до push.
Visit теперь пишет значения, а не строит полные строки каждого поддерева. Array
обход не создаёт Array длиной input.length заранее. Сортировка keys, порядок arrays,
JSON.stringify скаляров, depth и ancestor cycle checks сохранены. Snapshot не получает
request budget. Публичные функции и внутренние структуры описаны в JSDoc и README.

Повторное ревью: проверены byte accounting без повторного подсчёта детей,
разделители/keys/escaping, cleanup ancestors в finally, null-prototype records,
shared references и depth. Частичный JSON не возвращается при отказе. Auth/ACL,
SQL и stock не перемещены в shared; сериализатор не обещает соответствие складским
требованиям вместо владельцев бизнес-сценариев.

Новых подтверждённых security defects в этом scope не найдено. Удалённый exploit,
безопасность зависимостей и соответствие всего проекта бизнес-требованиям этим
ревью не доказаны и не опровергнуты. Нет воспроизводимых findings Claude, кроме общей
оценки; приоритеты нельзя назначать всему проекту по этой оценке.

## Evidence

- Red: `pnpm --filter @warehouse/backend test:prepare`, затем
  `pnpm --filter @warehouse/backend exec jest --selectProjects unit --runInBand --runTestsByPath .test-dist/test/unit/http-foundation.spec.js`:
  новый regression failed, 393214 reads вместо значения ниже 262144. Остальные 18 passed.
- Green: тот же скомпилированный unit test плюс integration http-commands:
  `pnpm --filter @warehouse/backend exec jest --runInBand --runTestsByPath .test-dist/test/unit/http-foundation.spec.js .test-dist/test/integration/http-commands.spec.js`:
  43/43, два suites, exit 0. Отдельное измерение исправленного encoder — 23134 reads.
- В unit проверены точные границы UTF-8, escaping и punctuation; shared references,
  null-prototype record, empty array, boolean/null/finite numbers, depth 64/65;
  существующие cycles/getters/non-JSON и большой snapshot остаются проверяемыми.
- `pnpm lint`: exit 0. `pnpm check:pr`: exit 0, 631 backend tests / 49 suites, 41 web tests; 210 backend и 22 web source baselines без регрессий.

Первый integration запуск в sandbox не получил Docker: 21 integration failures
из-за setup, unit passed. Повтор с доступом к Docker/loopback прошёл без skip/fallback.
Логи: `/tmp/canonical-json-red.log`, `/tmp/canonical-json-green.log`,
`/tmp/canonical-json-lint.log`; временные файлы ОС может удалить.

## Матрица реализации и тестов

Все unit cases ниже находятся в `apps/backend/test/unit/http-foundation.spec.ts`.

| AC    | Код                                                          | Проверяющий test                                                                                                                                                                    |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CJ-01 | encodeCanonicalJson.append + visit                           | request budget stops expansion of shared references before traversing the full graph                                                                                                |
| CJ-02 | append + Object.keys.sort + array loop                       | request budget counts exact UTF-8, escaping and object punctuation boundaries; both serializers preserve wire values…                                                               |
| CJ-03 | canonicalSnapshotJson + общий visit                          | request byte budget does not truncate server-owned snapshots; both serializers preserve wire values…                                                                                |
| CJ-04 | HttpCommandsService.execute, вызовы request/snapshot encoder | integration/http-commands.spec.ts: normalized repeat returns original status/body/Location…; large server snapshot commits and replays without weakening request fingerprint budget |

Дополнительная разовая проверка совместимости сравнила encoder из HEAD и итоговый
compiled encoder на 2000 детерминированных JSON (seed=301, вложенность≤5, Unicode,
escaping, массивы/объекты/скаляры): все байты совпали. Это дополнительное evidence,
постоянные regression cases находятся в unit/integration tests.

Финальный общий gate: `/tmp/canonical-json-check-pr.log`. Backend Jest/V8:
statements/lines 90,84%, branches 94,58%, functions 89,42%. Web Vitest/V8:
statements 59,06%, lines 64,11%, branches 72,34%, functions 53,68%.
100% покрытия всего проекта не заявляется. Cross-tab/browser cookie races, registry
audit, новый load baseline и внешний deployment не входят в scope этого изменения.
Фактические HTTP command/replay и Chromium проверены общим gate на disposable БД.
После успешного gate изменён только текст результатов; formatter выполнен отдельно.
