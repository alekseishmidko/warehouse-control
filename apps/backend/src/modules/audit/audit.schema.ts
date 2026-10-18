/** @file Drizzle schema audit-owned append-only журнала; permissions/trigger — отдельная SQL migration. */
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { SafeAuditChange } from './dto/audit-entry.dto';

/** Хранит субъекта, факт, основание и безопасные изменения; не хранит HTTP bodies или credentials. */
export const auditEntries = pgTable('audit_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  correlationId: uuid('correlation_id').notNull(),
  reasonCode: text('reason_code').notNull(),
  changes: jsonb('changes').$type<Record<string, SafeAuditChange>>().default({}).notNull(),
  hasRedactedChanges: boolean('has_redacted_changes').default(false).notNull(),
}, table => [
  check('audit_actor_type', sql`${table.actorType} in ('user', 'system')`),
  check('audit_action_code', sql`${table.action} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${table.action}) <= 96`),
  check('audit_entity_type_code', sql`${table.entityType} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${table.entityType}) <= 96`),
  check('audit_reason_code', sql`${table.reasonCode} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${table.reasonCode}) <= 96`),
  check('audit_changes_object', sql`jsonb_typeof(${table.changes}) = 'object'`),
  index('audit_entity_time_idx').on(table.entityType, table.entityId, table.occurredAt),
  index('audit_correlation_idx').on(table.correlationId),
]);
