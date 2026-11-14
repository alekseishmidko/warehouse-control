# 0033. Schema Registry и выпуск Kafka contracts

Статус: принято по результатам WMS-502 spike. Уточняет ADR-0011 и ADR-0032;
не заменяет JSON Schema 2020-12, open optional extensions или DB outbox.

## Решение

Dev Registry — Apicurio 3.3.4 с pinned image digest, отдельный in-memory Compose,
loopback HTTP. Это восстановимый каталог Git schemas, не production storage/HA.
Production deployment, auth/RBAC и persistence требуют отдельного решения перед
внешним стендом. Runtime consumers используют прежний EventContracts/Ajv2020
(8.20.0 + ajv-formats3.0.1), без REST lookup внутри business transaction.

Subject: Registry group default, artifact `<eventType>.v<schemaVersion>`.
Revision — SHA-256 канонической Git schema. Major envelope version и registry revision
различаются; aggregateVersion не выбирает subject. Topic определяется aggregateType:
order-changed и shipping-changed сохраняют один order topic/key. Новая schema major
не меняет topic/key и logical consumer name.

Broker value остаётся plain UTF-8 JSON envelope без schema-ID/magic-byte prefix.
Registry — release-time проверка/каталог, не причина менять eventId или wire envelope.
AsyncAPI 2.6.0 использует явный draft-2020-12 schemaFormat. Parser3.6.6 получает
Ajv2020 plugin: default draft07 parser не используется для этих payload.

Результат live spike: Apicurio3.3.4 хранит schemas2020-12,
но native FULL_TRANSITIVE не умеет определить этот dialect: даже annotation change
даёт HTTP422 UnprocessableSchemaException (could not determine version).
Дополнительный probe: server VALIDITY=FULL принял некорректный JSON Schema type.
Поэтому server rules VALIDITY=FULL, COMPATIBILITY=NONE — только фиксированная config,
не доказательство native strict2020-12 validation/compatibility.
Строгую проверку metaschema/fixtures выполняет Ajv2020 до любого Registry write,
в том числе внутри publication adapter. FULL_TRANSITIVE release policy обеспечивает обязательный local
fail-closed checker по ВСЕМ Registry revisions до POST новой версии: existing constraints заморожены, annotation changes
допустимы, новая optional property допустима только как unconstrained extension
в open object. Typed optional property сужает ранее допустимое произвольное значение;
это не автоматически совместимое изменение. Новые required/type/bounds/enum/if/then
changes требуют нового major artifact и consumers-first плана. Checker консервативен,
не является общим доказателем JSON Schema subsumption. Безопасные изменения вне
поддерживаемого поднабора также требуют явного review; не выключать rules ради green.

## Последствия

Публикация явная, выполняется из Git после generation/diff checks. Предыдущие revisions
не перезаписываются; нет обещания атомарности пяти artifacts или конкурирующих releases.
Schema release сериализует оператор; check после publish обязателен до producer.
Дрейф, изменение ожидаемых server rules и несовместимая история приводят к fail closed.
Сначала consumers понимают старые/новые сообщения и имеют start-position/replay план;
затем schema publication/check; только после этого новый producer. Неизвестная major
остаётся permanent отказом до DB effects/offset commit (детали recovery WMS-505).

[Runbook и pipeline](../flows/schema-release.md), [spike/evidence](../reports/wms-502.md).

## Альтернативы и доверенная граница

Понижать схемы до draft07 нельзя: source содержит 2020-12, if/then/const и форматные
ограничения. Выдавать принятие схемы Registry за proof native compatibility нельзя.
В этой реализации Registry — каталог, release CLI/Ajv — validity и compatibility boundary.
Raw privileged REST writer может обойти local guard; dev loopback endpoint не является
production security boundary. Перед внешним стендом writer permissions должны быть
ограничены release pipeline либо выбран Registry с native2020-12 compatibility.
Это явное эксплуатационное ограничение, не закрытый production security gate.
