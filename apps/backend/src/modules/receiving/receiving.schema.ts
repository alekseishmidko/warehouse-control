/** @file Receiving-owned документ и строки: UUID/FK, int4, один SKU и позиция на документ. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { products } from '../catalog/catalog.schema';
import { locations } from '../warehouses/warehouses.schema';
import { outboxEvents } from '../../infrastructure/outbox/outbox.schema';
import { MAX_RECEIPT_LINES } from '../../shared/events/event-registry';
import { MAX_STOCK_QUANTITY } from '../../shared/quantities/quantity';
/** Один draft либо полностью проведённый документ; immutable guards находятся в custom migration. */
export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey(), warehouseId: uuid('warehouse_id').notNull(), receivingLocationId: uuid('receiving_location_id').notNull(),
  status: text('status').$type<'draft' | 'posted'>().default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }), postedEventId: uuid('posted_event_id').references(() => outboxEvents.eventId).unique(),
}, t => [unique('receipt_putaway_source_unique').on(t.id, t.warehouseId, t.receivingLocationId, t.postedEventId),
  foreignKey({ name: 'receipt_location_warehouse_fk', columns: [t.warehouseId, t.receivingLocationId], foreignColumns: [locations.warehouseId, locations.id] }),
  check('receipt_state', sql`(${t.status} = 'draft' and ${t.postedAt} is null and ${t.postedEventId} is null) or (${t.status} = 'posted' and ${t.postedAt} is not null and ${t.postedEventId} is not null)`)]);
/** Неизменяемые строки; unique position + диапазон ограничивают размер даже при прямом INSERT. */
export const receiptLines = pgTable('receipt_lines', {
  id: uuid('id').primaryKey(), receiptId: uuid('receipt_id').notNull().references(() => receipts.id),
  position: integer('position').notNull(), productId: uuid('product_id').notNull().references(() => products.id), quantity: integer('quantity').notNull(),
}, t => [unique('receipt_line_putaway_source_unique').on(t.receiptId, t.id, t.productId, t.quantity),
  unique('receipt_line_position_unique').on(t.receiptId, t.position), unique('receipt_line_product_unique').on(t.receiptId, t.productId),
  check('receipt_line_position', sql`${t.position} between 1 and ${sql.raw(String(MAX_RECEIPT_LINES))}`),
  check('receipt_line_quantity', sql`${t.quantity} between 1 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`)]);
