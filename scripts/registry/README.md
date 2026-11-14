# Проверка и публикация контрактов

## Назначение и данные

Git schemas — source of truth. CLI не отправляет Kafka messages, не изменяет stock,
не открывает DB transaction. Вход — доверенные schema paths/examples Git; внешние
message/body проверяет runtime EventContracts. Registry используется при release,
его недоступность не переносится в бизнес-транзакцию.

| Файл               | Назначение                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| contracts.cjs      | Явная aggregate topology, canonical revision, консервативный compatibility checker, AsyncAPI document       |
| check.cjs          | Source/fixture validation Ajv2020; Git base comparison; AsyncAPI parser и exact generated diff              |
| client.cjs         | Bounded loopback-only Registry REST v3; immutable revision, full history, rules и latest/read-back equality |
| publish.cjs        | Публичные команды publish/check, обязательный offline preflight                                             |
| profile.cjs        | Local Docker guard, isolated Compose lifecycle, HTTP readiness                                              |
| gate.cjs           | Live integration spike, root entry points, реальные server rejection и runtime consumer validation          |
| contracts.test.cjs | Native regressions compatibility/endpoint/AsyncAPI dialect                                                  |

## Команды

- `pnpm asyncapi:generate` создаёт docs/contracts/asyncapi.json из schemas/topology.
- `pnpm schemas:check` проверяет generation и совместимость с HEAD; для release
  `WMS_SCHEMA_BASE=<last accepted Git commit> pnpm registry:publish` задаёт обязательный baseline
  перед публикацией. Offline check с другим base: `pnpm exec node scripts/registry/check.cjs --base <commit>`.
- `pnpm test:registry` — native tests без Docker; включены вместе с schemas:check в check:pr.
- `pnpm registry:up`, `registry:publish`, `registry:check`, `registry:down` — local lifecycle.
- `pnpm registry:gate` — полный dev spike, включая production build consumer validator.

Publish требует явный WMS_SCHEMA_BASE. Для первого пустого dev bootstrap допустим
WMS_SCHEMA_BASE=HEAD; это не выбор baseline для последующих releases.
В normal check Git base defaults HEAD: он ловит незакоммиченный breaking diff, но
не является сравнением всей истории после squash/merge. Release обязан задавать
accepted base, а live Registry sync проверяет ВСЕ сохранённые revisions. История до
1000 versions обрабатывается; больше блокируется fail closed, не обрезается молча.

## Pipeline и отказы

Schema validity и example проходят до REST; AsyncAPI формат проверяется parser3.6.6
с Ajv2020 plugin. Local compatibility применяется к каждой старой revision, затем
Server VALIDITY=FULL не обеспечивает strict metaschema2020-12 (live probe принят),
поэтому общий local Ajv проверяет candidate и historical schemas, а local guard
обеспечивает FULL_TRANSITIVE. Registry используется как каталог. Изменённые/missing server
rules не чинятся silently. Revision content-addressed; exact content и latest content
сравниваются с Git. Повторная публикация текущей revision не создаёт дубль.

Сетевой request ограничен 15s; redirect запрещён. Ошибки сообщают HTTP status/path,
не response body, credentials или driver errors. Docker compose шаг ограничен 240s,
readiness120s. Никаких skip/fallback при недоступном Docker/Registry.
Atomic all-artifacts transaction отсутствует; сериализовать release и повторять
post-publication check до включения producer. Pipeline не является внешним CI:
локальный обязательный gate можно подключить к будущему CI без изменения правил.

[Policy/rollout/recovery](../../docs/flows/schema-release.md), [ADR](../../docs/adr/0033-schema-registry-contract-release.md).

Native Apicurio3.3.4 compatibility не обрабатывает этот dialect (live HTTP422).
Поэтому server COMPATIBILITY=NONE задан явно; убрать local checker или считать прямой
REST write безопасным нельзя. Local policy проверяет все revisions до POST, но не
защищает от привилегированного writer, обошедшего pipeline. [Доверие и ADR](../../docs/adr/0033-schema-registry-contract-release.md).

Evolution с refs/unevaluated keywords отклоняется fail closed: checker не доказывает
произвольную JSON Schema subsumption. Даже безопасные annotation edits таких схем
потребуют отдельного review/расширения проверяемого поднабора.
