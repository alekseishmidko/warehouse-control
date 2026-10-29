/** @file Схема товаров: стабильная идентичность, уникальный SKU и штучная единица учёта.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
/** Товар одной организации; multi-tenancy и партии не реализованы. */
export const products = pgTable(
  'products',
  {
    /**
     * Внутренняя стабильная идентичность товара: UUID не зависит от изменяемого SKU. defaultRandom
     * генерирует UUID в БД; порядок создания из него не следует.
     */
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * Бизнес-код text с UNIQUE: нормализуется сервисом в верхний регистр, CHECK допускает 1..64
     * ASCII-символа. text сам не ограничивает длину и не нормализует регистр.
     */
    sku: text('sku').notNull().unique(),

    /**
     * Название text для человека: CHECK ограничивает длину trim(name) до 1..160 символов, но не
     * обрезает и не меняет сохранённую строку.
     */
    name: text('name').notNull(),
    /**
     * Единица учёта piece. text + CHECK допускает только штучный товар; $type помогает TypeScript, но
     * не выполняет runtime-проверку. Вес/дроби пока не поддержаны.
     */
    unit: text('unit').$type<'piece'>().default('piece').notNull(),
  },
  (t) => [
    check('product_sku_code', sql`${t.sku} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
    check('product_name_nonempty', sql`length(trim(${t.name})) between 1 and 160`),
    check('product_unit_piece', sql`${t.unit} = 'piece'`),
  ],
);
