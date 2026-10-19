/** @file Inventory-owned balances/movements: int4 checks, unique stock key и composite location ownership FK. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { MAX_STOCK_QUANTITY } from '../../shared/quantities/quantity';
import { products } from '../catalog/catalog.schema';
import { locations } from '../warehouses/warehouses.schema';
import { auditEntries } from '../audit/audit.schema';
/** Единственный физический баланс SKU в ячейке, 0 <= reserved <= onHand <= MAX. */
export const stockBalances = pgTable('stock_balances', {
  id: uuid('id').defaultRandom().primaryKey(), warehouseId: uuid('warehouse_id').notNull(), locationId: uuid('location_id').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id),
  onHand: integer('on_hand').default(0).notNull(), reserved: integer('reserved').default(0).notNull(),
}, t => [
  unique('stock_balance_key_unique').on(t.warehouseId, t.locationId, t.productId),
  foreignKey({ name: 'balance_location_warehouse_fk', columns: [t.warehouseId, t.locationId], foreignColumns: [locations.warehouseId, locations.id] }),
  check('stock_on_hand_range', sql`${t.onHand} between 0 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`),
  check('stock_reserved_range', sql`${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`),
]);
/** Неизменяемый приход одной строки с обязательным audit; другие виды movements — будущие migrations. */
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(), operationId: uuid('operation_id').notNull().unique(),
  warehouseId: uuid('warehouse_id').notNull(), locationId: uuid('location_id').notNull(), productId: uuid('product_id').notNull(),
  kind: text('kind').$type<'receipt'>().default('receipt').notNull(), quantity: integer('quantity').notNull(),
  auditId: uuid('audit_id').notNull().references(() => auditEntries.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: 'movement_balance_key_fk', columns: [t.warehouseId, t.locationId, t.productId], foreignColumns: [stockBalances.warehouseId, stockBalances.locationId, stockBalances.productId] }),
  check('movement_quantity_range', sql`${t.quantity} between 1 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`),
  check('movement_receipt_kind', sql`${t.kind} = 'receipt'`),
]);
