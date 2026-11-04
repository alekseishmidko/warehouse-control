# Аудит приложения — 2026-11-04–05

Проверка текущего рабочего дерева, включая незакоммиченный WMS-208 и исправления
Compose. Аудит не означает доказательство отсутствия дефектов во всём приложении.

## Область и требования до изменения

Просмотрены entry points и scripts, границы backend-модулей, transaction runner,
HTTP idempotency/guard/problem filter, identity/session/ACL, keyset pagination,
frontend transport/journal/session/workspace и основные формы. Для inventory и
fulfillment дополнительно выполнен существующий PostgreSQL/Chromium gate;
построчное ревью всех SQL и всех interleavings в этот аудит не входит.

Вход: HTTP response и доступ к browser storage недоверенные. Сервер по-прежнему
задаёт actor, права и бизнес-правила. Успех команды подтверждается ответом API;
неизвестный исход требует сохранения прежних URL/body/key и явного replay.
Отказ browser storage не должен ломать вход и чтение, но запрещает новую команду
без сохранённого запроса. SQL, migrations, ACL и session policy не меняются.

| AC          | Принятый результат                                                                                      | Реализация и evidence                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| AC-AUDIT-01 | HTTP 408 не удаляет команду и не разрешает новое намерение; явный replay использует прежний key/body    | CommandJournal.dispatch; regression в journal.test.ts                        |
| AC-AUDIT-02 | SecurityError при получении sessionStorage не ломает SessionProvider; отправка без сохранения запрещена | Ленивое получение Storage; regression в workspace.test.tsx и journal.test.ts |

## Замечания

- P2, CommandJournal.dispatch: первый HTTP 408 попадал в общий диапазон 4xx и
  удалял pending. Ответ timeout не служит подтверждением бизнес-отказа; последующее
  новое намерение могло получить другой key. Нужно сохранять исходную команду и
  показывать неопределённый результат.
- P2, SessionProvider: получение global sessionStorage происходило до обработки
  ошибок CommandJournal. Если browser policy запрещает доступ уже на getter,
  рендер provider завершается исключением. Защита getItem/setItem это не покрывает.
  Нужен отложенный доступ к storage внутри существующей границы обработки ошибок.

Новых бизнес-решений нет. Миграции и внешнее развёртывание не требуются.

## Зависимости: дополнение к критериям до обновления

AC-AUDIT-03: `pnpm audit --prod` не находит известных advisory после адресного
обновления четырёх транзитивных пакетов. Проверки приложения, генерации контрактов
и Docker image должны пройти; изменения major-версий не нужны.

Исходный `pnpm audit --prod` завершился с exit 1: 7 advisory (2 high, 3 moderate,
2 low). Наличие пакета подтверждено lockfile, эксплуатация приложения не доказана.

| Пакет       | Было  | Исправленная версия | Источник                                                                                                  |
| ----------- | ----- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| body-parser | 2.3.0 | 2.4.0               | [compressed body DoS](https://github.com/advisories/GHSA-27r3-jxmh-p828)                                  |
| multer      | 2.4.0 | 2.5.0               | [async fileFilter DoS](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)                                 |
| js-yaml     | 5.3.0 | 5.4.1               | [merge CPU limits](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm)                                     |
| fast-uri    | 3.1.8 | 3.1.9               | [URI scheme spoofing](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) и ещё три advisory из audit JSON |

HTTP JSON parser принимает внешние body. Multipart routes не обнаружены; Swagger
и AJV здесь не загружают произвольные внешние YAML/schema. Поэтому severity базы
не приравнивается к подтверждённой достижимости всех уязвимостей через WMS API.

## Исправления, рефакторинг и повторное ревью

Оба P2 исправлены. До исправления два новых теста падали; после исправления
целевой прогон прошёл 26/26. CommandJournal сначала классифицирует 408/5xx как
UncertainResult и сохраняет запись. Явный replay проверяет прежние body/key;
новое намерение до разрешения pending отклоняется без второго HTTP-запроса.

Storage или factory разрешаются одним private getStorage. SessionProvider передаёт
factory. Это переносит browser getter в существующие try/catch без нового слоя или
дублирования error handling. SecurityError не ломает session restore и чтение;
попытка команды возвращает COMMAND_SAVE_FAILED и не отправляет POST.

Повторное ревью охватило initial send/replay, 401/403/409/408/5xx, сохранение key,
порядок storage → HTTP, inFlight/finally и реальных потребителей SessionProvider.
Существующие гарантии actor/warehouse/CSRF и query cache сохранены. Новых подтверждённых
дефектов в изменённых путях после повторного ревью не выявлено.

AC-AUDIT-03 реализован точными version-specific pnpm.overrides в package.json и
штатно обновлённым lockfile. Override затрагивает только перечисленные уязвимые
версии. Причины и ссылки приведены выше. Direct Nest/AJV версии не менялись.
Не запускались audit --fix, массовое latest обновление или ослабление coverage baseline.

## Команды и результаты

Итоговая среда: Node 24.19.0, pnpm 10.18.3, Docker Desktop, установленный Playwright
Chromium. Для pnpm использовался временный Corepack shim в /tmp; файлы приложения
и пользовательские настройки package manager для этого не менялись.

| Команда                             | Результат                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`    | exit 0, lockfile актуален                                                                                                                                                   |
| `pnpm audit --prod`                 | exit 0, известных advisory нет (до обновления 7)                                                                                                                            |
| `pnpm check:pr` на Node 24.19.0     | exit 0: формат, typed lint, architecture, 9 quality tests, 9 dev tests, typecheck, build, generated contracts/OpenAPI, Vitest, Jest, Chromium                               |
| Vitest внутри `pnpm test:web`       | 37/37, 4 файла; оба новых regression tests входят в прогон                                                                                                                  |
| Backend Jest внутри `pnpm check:pr` | 576/576, 39 suites, реальные migrations/PostgreSQL и Chromium gate 2                                                                                                        |
| `pnpm docker:image-check`           | exit 0: чистый context, frozen install, no-cache build, canary layers scan                                                                                                  |
| `pnpm docker:gate`                  | exit 0: origin default/override, health/401, миграции, worker, replay, складские сценарии, SIGTERM                                                                          |
| `pnpm app:up` с существующей .env   | exit 0, API healthy и worker running                                                                                                                                        |
| `pnpm web:dev`                      | HTTP 200 для SPA и изменённого journal модуля; после Ctrl+C порт 5173 свободен. pnpm wrapper возвращает exit 1 при сигнале SIGINT; это ручная остановка, не startup failure |
| `PORT=4401 pnpm dev:all`            | build/migrate, API/worker/Vite ready; health 200, SPA 200, proxy auth/me 401; Ctrl+C → exit 0                                                                               |

Порт 4401 в dev:all выбран, чтобы не занимать 4400 работающего контейнерного API.
.env не переписывалась, seed/bootstrap не запускались, рабочие volumes не удалялись.
Тестовые контейнеры используют disposable БД; app:up/dev:all запускают штатные migrations.
После dev:all остановлены только его процессы; контейнерный backend оставлен работающим.

## Покрытие и ограничения

Backend: 201 source, V8/Jest lines/statements 90.52%, branches 94.49%, functions
89.76%. Web: 22 source, V8/jsdom lines 62.20%, statements 57.77%, branches 72.36%,
functions 52.81%. Оба per-file guard прошли без изменения baseline. Основные gaps
остаются в UI callbacks/pages, DTO OpenAPI callbacks и child-process CLI. Browser
coverage не объединяется с unit coverage. Это не 100% бизнес-веток или code coverage.

Первый check:pr на Node 22.23.3 прошёл все 576 backend tests, но завершился exit 1
на backend coverage guard: V8 дал другие lines/statements DTO (общие lines 89.54%).
Повтор на Node 24.19.0 дал исходные 90.52% и прошёл gate. Разница измерения между
Node majors остаётся ограничением: зелёный coverage gate на Node 22 не подтверждён,
baseline не понижен и provider не подменён ради прохождения.

Аудит ограничен перечисленными путями и доступными сценариями. Не выполнялись
полный pentest, нагрузочные/DoS пробы, все возможные SQL interleavings, аудит внешнего
deployment/TLS gateway и аудит devDependencies. Отсутствие production advisory
не означает отсутствия неизвестных уязвимостей. Результат не разрешает публикацию.
