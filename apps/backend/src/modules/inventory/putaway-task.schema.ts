/** @file Inventory-owned putaway tasks: одна задача на receipt line, immutable provenance и отсутствие stock mutation. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { receipts, receiptLines } from '../receiving/receiving.schema';
import { auditEntries } from '../audit/audit.schema';
import { MAX_STOCK_QUANTITY } from '../../shared/quantities/quantity';
/** Снимок основания размещения, не резерв и не движение; target location появится при выполнении размещения. */
export const putawayTasks = pgTable('putaway_tasks', {
  id: uuid('id').primaryKey(), sourceReceiptId: uuid('source_receipt_id').notNull(),
  sourceReceiptLineId: uuid('source_receipt_line_id').notNull().unique(), sourceEventId: uuid('source_event_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(), sourceLocationId: uuid('source_location_id').notNull(),
  productId: uuid('product_id').notNull(), quantity: integer('quantity').notNull(),
  status: text('status').$type<'pending'>().default('pending').notNull(),
  auditId: uuid('audit_id').notNull().references(() => auditEntries.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [unique('putaway_event_line_unique').on(t.sourceEventId, t.sourceReceiptLineId),
  // Composite FK проверяют business provenance без чтения чужих repositories:
  // документ posted именно этим event, line/product/quantity действительно принадлежат ему.
  foreignKey({ name: 'putaway_receipt_source_fk', columns: [t.sourceReceiptId, t.warehouseId, t.sourceLocationId, t.sourceEventId],
    foreignColumns: [receipts.id, receipts.warehouseId, receipts.receivingLocationId, receipts.postedEventId] }),
  foreignKey({ name: 'putaway_receipt_line_fk', columns: [t.sourceReceiptId, t.sourceReceiptLineId, t.productId, t.quantity],
    foreignColumns: [receiptLines.receiptId, receiptLines.id, receiptLines.productId, receiptLines.quantity] }),
  check('putaway_pending_status', sql`${t.status} = 'pending'`),
  check('putaway_quantity_range', sql`${t.quantity} between 1 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`)]);
