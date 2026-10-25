/** @file Worker-owned processed markers и consumer cursors; retention без удаления до replay policy. */
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { outboxEvents, outboxAggregateSequences } from '../outbox/outbox.schema';
import { foreignKey } from 'drizzle-orm/pg-core';
import { MAX_AGGREGATE_VERSION } from '../outbox/outbox-destinations';
/** Уникальный факт применения event данным logical consumer, не ack Kafka. */
export const processedEvents = pgTable('processed_events', {
  consumerName: text('consumer_name').notNull(), eventId: uuid('event_id').notNull().references(() => outboxEvents.eventId),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.consumerName, t.eventId] }), check('processed_consumer_name', sql`${t.consumerName} ~ '^[a-z][a-z0-9.-]{0,95}$'`)]);
/** Отдельный consumer cursor сохраняется при будущем переносе транспорта с outbox на Kafka. */
export const consumerStreams = pgTable('consumer_streams', {
  consumerName: text('consumer_name').notNull(), aggregateType: text('aggregate_type').notNull(), aggregateId: uuid('aggregate_id').notNull(),
  lastProcessedVersion: bigint('last_processed_version', { mode: 'number' }).default(0).notNull(),
}, t => [primaryKey({ columns: [t.consumerName, t.aggregateType, t.aggregateId] }),
  foreignKey({ columns: [t.aggregateType, t.aggregateId], foreignColumns: [outboxAggregateSequences.aggregateType, outboxAggregateSequences.aggregateId] }),
  check('consumer_name', sql`${t.consumerName} ~ '^[a-z][a-z0-9.-]{0,95}$'`),
  check('consumer_cursor_range', sql`${t.lastProcessedVersion} between 0 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`)]);
