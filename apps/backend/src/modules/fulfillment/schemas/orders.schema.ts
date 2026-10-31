/** @file Заказ и immutable строки ADR-0022. UUID — строковые идентификаторы JS/JSON; int4 — целые штуки. */
import { pgTable, uuid, text, integer, check, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { warehouses } from '../../warehouses/warehouses.schema';
import { products } from '../../catalog/catalog.schema';
/** Заказ одного склада; lifecycle выполняет FulfillmentService под row lock. */
export const orders = pgTable(
  'orders',
  {
    /** UUID без default; назначается сервисом, PK исключает NULL. */ id: uuid('id').primaryKey(),
    /** Обязательный UUID FK склада, без default. */ warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Text CHECK: draft/active/cancelled, default draft; terminal назад не открывается. */ status:
      text('status').notNull().default('draft'),
  },
  (t) => [check('order_status', sql`${t.status} in ('draft','active','cancelled')`)],
);
/** Состав заказа после создания неизменен; open вычисляется по active allocations. */
export const orderLines = pgTable(
  'order_lines',
  {
    /** UUID строки без default. */ id: uuid('id').primaryKey(),
    /** Обязательный FK родителя; без cascade удаления истории. */ orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    /** Обязательный FK товара, один SKU на заказ. */ productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Int4 1..MAX, не дробь и не строка JSON; без default. */ quantity:
      integer('quantity').notNull(),
  },
  (t) => [
    unique('order_product_unique').on(t.orderId, t.productId),
    check('order_quantity', sql`${t.quantity} between 1 and 2147483647`),
  ],
);
