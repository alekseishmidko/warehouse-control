/** @file Схемы складов и ячеек: адреса и составные ключи принадлежности складу.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { LocationKind } from './dto/warehouse.dto';
/** Склад одной организации, код уникален. */
export const warehouses = pgTable(
  'warehouses',
  {
    /**
     * UUID склада — стабильная внутренняя ссылка независимо от кода/названия; defaultRandom назначает
     * БД, сортировку по времени не гарантирует.
     */
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * Уникальный бизнес-код склада. text + CHECK задаёт формат/длину, UNIQUE предотвращает гонку двух
     * одинаковых INSERT; нормализация регистра — задача сервиса.
     */
    code: text('code').notNull().unique(),
    /**
     * Читаемое название, не идентификатор. text допускает Unicode; CHECK проверяет trim длиной 1..160
     * символов, но не нормализует само значение.
     */
    name: text('name').notNull(),
  },
  (t) => [
    check('warehouse_code', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
    check('warehouse_name', sql`length(trim(${t.name})) between 1 and 160`),
  ],
);
/** Ячейка с FK на склад; (warehouseId,id) служит target composite FK баланса. */
export const locations = pgTable(
  'locations',
  {
    /**
     * UUID ячейки, независимый от её кода. Отдельный составной UNIQUE (warehouseId,id) нужен как цель
     * FK, проверяющего принадлежность складу.
     */
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * UUID владельца-склада и FK на warehouses. NOT NULL не позволяет бесхозную ячейку; FK проверяет
     * существование, не права вызывающего.
     */
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),

    /**
     * Адрес ячейки: text с ограниченным форматом. UNIQUE действует только внутри warehouseId, поэтому
     * одинаковый код допустим в разных складах.
     */
    code: text('code').notNull(),
    /**
     * Тип зоны receiving/storage/shipping. text + CHECK сохраняет закрытый набор; LocationKind/$type
     * не заменяет SQL CHECK и не даёт менять назначение зоны без правил сервиса.
     */
    kind: text('kind').$type<LocationKind>().notNull(),
  },
  (t) => [
    unique('location_warehouse_code_unique').on(t.warehouseId, t.code),
    // id уже глобально уникален, но PostgreSQL требует подходящий UNIQUE для составного FK
    // (warehouseId,locationId); дублирование ключа осознанно защищает согласованность принадлежности.
    unique('location_warehouse_id_unique').on(t.warehouseId, t.id),
    check('location_code', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
    check('location_kind', sql`${t.kind} in ('receiving', 'storage', 'shipping')`),
  ],
);
