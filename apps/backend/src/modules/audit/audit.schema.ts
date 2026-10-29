/** @file Схема неизменяемого аудита; защитные триггеры и SQL-права находятся в custom migrations.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { SafeAuditChange } from './dto/audit-entry.dto';

/** Хранит субъекта, факт, основание и безопасные изменения; не хранит HTTP bodies или credentials. */
export const auditEntries = pgTable(
  'audit_entries',
  {
    /**
     * UUID записи аудита, назначаемый БД по умолчанию; отдельный PK нужен для FK из движений, заданий
     * и истории восстановления.
     */
    id: uuid('id').defaultRandom().primaryKey(),

    /**
     * Категория субъекта user/system хранится text и ограничена CHECK. Это утверждение сценария, а не
     * доказательство аутентификации.
     */
    actorType: text('actor_type').notNull(),

    /**
     * UUID субъекта, сформированный серверным контекстом. Нет FK на пользователей: identity-модуль ещё
     * не реализован, системный субъект также имеет UUID.
     */
    actorId: uuid('actor_id').notNull(),

    /**
     * Технический код действия, а не свободное описание. text + CHECK задаёт slug до 96 символов для
     * стабильного поиска и безопасного аудита.
     */
    action: text('action').notNull(),

    /**
     * Логический тип объекта; вместе с entityId образует полиморфную ссылку. CHECK ограничивает
     * формат, но не проверяет существование бизнес-объекта.
     */
    entityType: text('entity_type').notNull(),

    /**
     * UUID объекта аудита. Универсальный FK на разные таблицы здесь отсутствует; корректную ссылку
     * передаёт владелец сценария.
     */
    entityId: uuid('entity_id').notNull(),

    /**
     * Время записи аудита в timestamptz. defaultNow берётся от начала транзакции и не доказывает ни
     * порядок commit, ни глобальный порядок операций.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),

    /**
     * UUID связывает аудит с командой/событием для диагностики. Не уникален: один сценарий законно
     * создаёт несколько записей аудита.
     */
    correlationId: uuid('correlation_id').notNull(),

    /**
     * Основание действия как технический slug до 96 символов. text не ограничивает длину
     * самостоятельно; свободные комментарии/credentials сюда не пишутся.
     */
    reasonCode: text('reason_code').notNull(),

    /**
     * JSONB безопасных изменений: разнородные поля не требуют отдельной колонки на каждое действие.
     * CHECK требует object, $type не валидирует содержимое; маскирует AuditService.
     */
    changes: jsonb('changes').$type<Record<string, SafeAuditChange>>().default({}).notNull(),

    /**
     * Boolean отмечает факт маскирования, а не хранит скрытые значения. false по умолчанию; сервис
     * обязан согласовать флаг с подготовленными changes.
     */
    hasRedactedChanges: boolean('has_redacted_changes').default(false).notNull(),
  },
  (table) => [
    check('audit_actor_type', sql`${table.actorType} in ('user', 'system')`),
    check(
      'audit_action_code',
      sql`${table.action} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${table.action}) <= 96`,
    ),
    check(
      'audit_entity_type_code',
      sql`${table.entityType} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${table.entityType}) <= 96`,
    ),
    check(
      'audit_reason_code',
      sql`${table.reasonCode} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${table.reasonCode}) <= 96`,
    ),
    check('audit_changes_object', sql`jsonb_typeof(${table.changes}) = 'object'`),
    // Составной B-tree обслуживает историю конкретного entityType/entityId по времени.
    // Его левый префикс важен: выборка только по entityId не эквивалентна выборке по всему ключу.
    index('audit_entity_time_idx').on(table.entityType, table.entityId, table.occurredAt),
    // Отдельный B-tree для связи записей одного сценария, без обхода JSONB changes.
    index('audit_correlation_idx').on(table.correlationId),
  ],
);
