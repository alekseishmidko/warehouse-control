/** @file Outbox-owned PostgreSQL schema: атомарный счётчик, immutable envelope, delivery и ordered stream. */
import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { KnownEvent } from '../../shared/events/dto/event.dto';
import { MAX_AGGREGATE_VERSION, PUTAWAY_DESTINATION } from './outbox-destinations';

/** Транзакционный счётчик вместо nextval: rollback не расходует версию; PK сериализует первый INSERT агрегата. */
export const outboxAggregateSequences = pgTable('outbox_aggregate_sequences', {
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  lastVersion: bigint('last_version', { mode: 'number' }).notNull(),
}, t => [
  primaryKey({ columns: [t.aggregateType, t.aggregateId] }),
  check('outbox_sequence_range', sql`${t.lastVersion} between 1 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`),
  check('outbox_sequence_aggregate', sql`${t.aggregateType} = 'receipt'`),
]);

/** Факт после записи не меняется; PK и unique stream version защищают от повторного eventId/sequence. */
export const outboxEvents = pgTable('outbox_events', {
  eventId: uuid('event_id').primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  aggregateVersion: bigint('aggregate_version', { mode: 'number' }).notNull(),
  envelope: jsonb('envelope').$type<KnownEvent>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique('outbox_event_aggregate_version_unique').on(t.aggregateType, t.aggregateId, t.aggregateVersion),
  foreignKey({ name: 'outbox_event_sequence_fk', columns: [t.aggregateType, t.aggregateId],
    foreignColumns: [outboxAggregateSequences.aggregateType, outboxAggregateSequences.aggregateId] }),
  check('outbox_event_version_range', sql`${t.aggregateVersion} between 1 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`),
  // SQL дополняет Ajv: индексируемая identity обязана совпадать с сохранённым envelope.
  // lower для UUID сохраняет допустимость uppercase UUID на JSON-границе.
  check('outbox_envelope_identity', sql`coalesce(jsonb_typeof(${t.envelope}) = 'object'
    and lower(${t.envelope}->>'eventId') = ${t.eventId}::text
    and ${t.envelope}->>'aggregateType' = ${t.aggregateType}
    and lower(${t.envelope}->>'aggregateId') = ${t.aggregateId}::text
    and (${t.envelope}->>'aggregateVersion')::bigint = ${t.aggregateVersion}, false)`),
  index('outbox_events_created_at_idx').on(t.createdAt),
]);

/** Курсор/lease на destination и агрегат; writer создаёт cursor=0 и никогда не сбрасывает существующий. */
export const deliveryStreams = pgTable('delivery_streams', {
  destination: text('destination').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  lastCompletedVersion: bigint('last_completed_version', { mode: 'number' }).default(0).notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  leaseToken: uuid('lease_token'),
}, t => [
  primaryKey({ columns: [t.destination, t.aggregateType, t.aggregateId] }),
  foreignKey({ name: 'delivery_stream_sequence_fk', columns: [t.aggregateType, t.aggregateId],
    foreignColumns: [outboxAggregateSequences.aggregateType, outboxAggregateSequences.aggregateId] }),
  check('delivery_stream_cursor_range', sql`${t.lastCompletedVersion} between 0 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`),
  check('delivery_stream_destination', sql`${t.destination} = ${sql.raw(`'${PUTAWAY_DESTINATION}'`)}`),
  check('delivery_stream_lease_pair', sql`(${t.leaseUntil} is null) = (${t.leaseToken} is null)`),
  index('delivery_streams_lease_idx').on(t.leaseUntil),
]);

/** Pending delivery создаётся writer; поля claim/retry/completion использует отдельный worker WMS-109. */
export const outboxDeliveries = pgTable('outbox_deliveries', {
  eventId: uuid('event_id').notNull().references(() => outboxEvents.eventId),
  destination: text('destination').notNull(),
  status: text('status').$type<'pending' | 'processing' | 'retry' | 'completed' | 'dead'>().default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  leaseToken: uuid('lease_token'),
  /** Только безопасный диагностический код; произвольные payload/driver errors здесь хранить запрещено. */
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.eventId, t.destination] }),
  check('outbox_delivery_destination', sql`${t.destination} = ${sql.raw(`'${PUTAWAY_DESTINATION}'`)}`),
  check('outbox_delivery_status', sql`${t.status} in ('pending', 'processing', 'retry', 'completed', 'dead')`),
  check('outbox_delivery_attempts', sql`${t.attempts} >= 0`),
  check('outbox_delivery_lease_pair', sql`(${t.leaseUntil} is null) = (${t.leaseToken} is null)`),
  check('outbox_delivery_completion', sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`),
  check('outbox_delivery_error_length', sql`length(${t.lastError}) <= 512`),
  index('outbox_deliveries_available_idx').on(t.availableAt).where(sql`${t.status} in ('pending', 'retry', 'processing')`),
]);
