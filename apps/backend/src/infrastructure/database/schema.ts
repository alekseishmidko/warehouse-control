/** @file Техническая Drizzle-схема WMS-101. Складских таблиц и автоматического seed нет. */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Метаданные инсталляции; не источник stock или версия состояния бизнес-агрегатов. */
export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
