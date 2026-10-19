/** @file Warehouses-owned таблицы: склад, ячейка, unique code и composite ownership key. */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { LocationKind } from './dto/warehouse.dto';
/** Склад одной организации, код уникален. */
export const warehouses = pgTable('warehouses', {
  id: uuid('id').defaultRandom().primaryKey(), code: text('code').notNull().unique(), name: text('name').notNull(),
}, t => [check('warehouse_code', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`), check('warehouse_name', sql`length(trim(${t.name})) between 1 and 160`)]);
/** Ячейка с FK на склад; (warehouseId,id) служит target composite FK баланса. */
export const locations = pgTable('locations', {
  id: uuid('id').defaultRandom().primaryKey(), warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  code: text('code').notNull(), kind: text('kind').$type<LocationKind>().notNull(),
}, t => [
  unique('location_warehouse_code_unique').on(t.warehouseId, t.code),
  unique('location_warehouse_id_unique').on(t.warehouseId, t.id),
  check('location_code', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
  check('location_kind', sql`${t.kind} in ('receiving', 'storage', 'shipping')`),
]);
