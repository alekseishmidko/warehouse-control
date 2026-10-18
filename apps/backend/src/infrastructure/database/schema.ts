/** @file Агрегатор Drizzle-схем metadata и audit для migrations; складских таблиц и seed нет. */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
export { auditEntries } from '../../modules/audit/audit.schema';

/** Метаданные инсталляции; не источник stock или версия состояния бизнес-агрегатов. */
export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
