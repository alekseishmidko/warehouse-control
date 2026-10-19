/** @file Catalog-owned products: unique normalized SKU и единица piece первого релиза. */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
/** Товар одной организации; multi-tenancy и партии не реализованы. */
export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(), sku: text('sku').notNull().unique(),
  name: text('name').notNull(), unit: text('unit').$type<'piece'>().default('piece').notNull(),
}, t => [
  check('product_sku_code', sql`${t.sku} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
  check('product_name_nonempty', sql`length(trim(${t.name})) between 1 and 160`),
  check('product_unit_piece', sql`${t.unit} = 'piece'`),
]);
