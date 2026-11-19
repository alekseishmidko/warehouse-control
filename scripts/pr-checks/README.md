# Полные PR gates — WMS-601

Локальные проверки не публикуют images, не создают внешний PR и не настраивают GitOps.
Пользователь задаёт AC; агент оформляет task JSON и review. `pnpm pr:pipeline <task.json>`
передаёт задачу существующему harness. Подробный процесс и ограничения —
[владелец flow](../../docs/flows/pr-pipeline.md).

## Компоненты и вход

| Файл                 | Ответственность                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| release.json         | Exact SHA предыдущего проверенного dev checkpoint. Это source policy, не evidence. Первоначальный checkpoint — WMS-506; release tags отсутствуют.    |
| source-inventory.cjs | Общий Git inventory для docs и compatibility; исключает deleted/build/cache, включает untracked source.                                              |
| compatibility.cjs    | Сравнивает весь baseline API/events/topology и retained migrations с candidate. Не сравнивает только незакоммиченный diff.                           |
| documentation.cjs    | Проверяет local links/anchors, явные записи каталога, file-level @file и public TS JSDoc, module README и syntax JS/TS.                              |
| helm.cjs             | Обязательные Helm v3.22.0 lint/template base/dev плюс optional adapters без cluster I/O.                                                             |
| checks.test.cjs      | Настоящие disposable Git/child processes: broken contract прерывает pipeline; frozen install не исправляет lockfile; guards не пропускают нарушения. |

Source schemas — docs/contracts/events. Их генератор/Registry policy остаются у
scripts/registry. Новый guard переиспользует assertCompatible вместо копирования
JSON Schema evolution. API guard консервативен: новые endpoints/components разрешены,
existing operation/schema/security freeze после удаления document annotations.
Изменения optional DTO fields тоже могут быть отклонены. Это fail closed, а не обещание
универсального OpenAPI compatibility solver. Для изменения контрактной policy нужен
review/ADR; нельзя передвигать baseline только ради green run.

Имена свойств description/title в JSON schema maps не удаляются как annotations.
Const/enum/default сравниваются как данные. Весь прежний event schema set сохраняется;
удаление схемы запрещено независимо от нынешнего списка registry. Topic/key/group map
не меняется без cutover решения. Прежние SQL/snapshots байтово неизменны, journal — prefix.
Runtime migration safety дополнительно проверяет настоящая baseline→candidate suite.

## Команды и диагностика

- `pnpm deps:check` — frozen install с prefer-offline, без lockfile update/fallback.
- `pnpm check:docs` — весь Git inventory. External URLs проверяются только как внешние,
  HTTP availability не заявляется. Markdown inline/ref targets и anchors проверяются локально;
  editor suffix `:line` разрешён. Содержательность комментариев остаётся review.
- `pnpm check:compatibility` — exact release checkpoint должен существовать и быть ancestor HEAD.
- `WMS_HELM=/absolute/path/helm pnpm check:helm` — бинарник можно задать явно; иначе PATH/standard local tool paths.
  Версия должна быть3.22.0. Missing/wrong version не превращается в skip.
- `pnpm test:pr-checks` — negative tests без рабочего Docker/БД; temporary Git repos удаляются finally.
- `pnpm pr:pipeline docs/tasks/wms-601.json` — install → check:pr → backend/web image checks
  → дополнительные task/diff gates. Для WMS-601 обязателен также docker:gate.
- `pnpm harness:ready docs/tasks/wms-601.json` — проверяет текущий snapshot/log hashes, не запускает тесты повторно.

У root scripts package.json нет произвольных shell commands из task JSON. Artifact/log
lifecycle, signal/deadline, source mutation и lock сохраняет прежний runner. Новые guards
не ослабляют typed lint, architecture, coverage или реальные integration. Ошибка
останавливает следующие gates. Логи private, так как compiler diagnostics могут содержать
source excerpts. Чтение чужого symlink target не является проверкой документации.
