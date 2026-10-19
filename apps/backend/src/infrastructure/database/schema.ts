/** @file Агрегатор module-owned Drizzle schemas metadata/audit/catalog/warehouses/inventory для migrations. */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
export { auditEntries } from '../../modules/audit/audit.schema';

/** Метаданные инсталляции; не источник stock или версия состояния бизнес-агрегатов. */
export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export { products } from '../../modules/catalog/catalog.schema';
export { warehouses, locations } from '../../modules/warehouses/warehouses.schema';
export { stockBalances, stockMovements } from '../../modules/inventory/inventory.schema';
