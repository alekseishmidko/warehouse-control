/** @file Схемы остатков и движений: int4 количества, один баланс позиции и неизменяемый приход.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { MAX_STOCK_QUANTITY } from '../../shared/quantities/quantity';
import { products } from '../catalog/catalog.schema';
import { locations } from '../warehouses/warehouses.schema';
import { auditEntries } from '../audit/audit.schema';
/** Единственный физический баланс SKU в ячейке, 0 <= reserved <= onHand <= MAX. */
export const stockBalances = pgTable(
  'stock_balances',
  {
    /**
     * UUID строки баланса удобен для внутренней ссылки; уникальность физического остатка задаёт не он,
     * а составной warehouse/location/product ключ.
     */
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * UUID склада входит в ключ баланса и составной FK ячейки: отдельные FK не защитили бы от
     * сочетания чужого склада и существующей ячейки.
     */
    warehouseId: uuid('warehouse_id').notNull(),
    /**
     * UUID физической ячейки. Принадлежность warehouseId проверяет составной FK; тип receiving для
     * прихода проверяет InventoryService.
     */
    locationId: uuid('location_id').notNull(),

    /**
     * UUID товара с FK на products: остаток не может ссылаться на отсутствующий SKU. Баланс хранит
     * ссылку, а не копию названия/кода.
     */
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),

    /**
     * Штучный физический остаток: PostgreSQL integer/int4, 0..2147483647 по CHECK. Точно представим JS
     * number; дроби/вес не поддерживаются. Переполнение SQL — ошибка, не обнуление.
     */
    onHand: integer('on_hand').default(0).notNull(),
    /**
     * Зарезервированная часть того же onHand, а не отдельный приход: int4, CHECK 0 <= reserved <=
     * onHand. Ноль — отсутствие резерва; операции резервирования ещё не реализованы.
     */
    reserved: integer('reserved').default(0).notNull(),
  },
  (t) => [
    // Это бизнес-ключ единственного баланса и цель ON CONFLICT guarded upsert.
    // UNIQUE защищает конкурентное создание, CHECK — допустимый результат арифметики.
    unique('stock_balance_key_unique').on(t.warehouseId, t.locationId, t.productId),
    foreignKey({
      name: 'balance_location_warehouse_fk',
      columns: [t.warehouseId, t.locationId],
      foreignColumns: [locations.warehouseId, locations.id],
    }),
    check(
      'stock_on_hand_range',
      sql`${t.onHand} between 0 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`,
    ),
    check('stock_reserved_range', sql`${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`),
  ],
);
/** Неизменяемый приход одной строки с обязательным audit; другие виды movements — будущие migrations. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    /**
     * UUID неизменяемого факта движения. Отделён от operationId: идентичность записи и защита от
     * повторного исполнения — разные задачи.
     */
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * UUID бизнес-операции с UNIQUE; для приёмки равен receipt line id. Конкурентный повтор
     * отклоняется, он не является новым движением.
     */
    operationId: uuid('operation_id').notNull().unique(),

    /**
     * UUID склада входит в составной FK на существующий баланс: движение должно относиться к той же
     * складской позиции.
     */
    warehouseId: uuid('warehouse_id').notNull(),
    /** UUID ячейки той же позиции баланса; сам по себе UUID не подтверждает её связь со складом. */
    locationId: uuid('location_id').notNull(),
    /**
     * UUID товара в составном ключе баланса; нельзя присоединить движение к другому товару при том же
     * складе/ячейке.
     */
    productId: uuid('product_id').notNull(),

    /**
     * Пока только receipt: text + CHECK сохраняет допустимое значение. Другие операции потребуют новой
     * миграции, изменения типов и правил, а не одного $type.
     */
    kind: text('kind').$type<'receipt'>().default('receipt').notNull(),
    /**
     * Положительное количество int4 в штуках, 1..MAX по CHECK. Направление задаёт kind, отрицательные
     * дельты текущая модель не принимает.
     */
    quantity: integer('quantity').notNull(),

    /**
     * Обязательный UUID/FK на объясняющую запись аудита. FK не делает записи атомарными сам: сценарий
     * обязан писать движение и аудит в одном context.
     */
    auditId: uuid('audit_id')
      .notNull()
      .references(() => auditEntries.id),

    /**
     * timestamptz времени вставки, defaultNow от начала транзакции; не замена operationId и не
     * доказательство порядка commit.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'movement_balance_key_fk',
      columns: [t.warehouseId, t.locationId, t.productId],
      foreignColumns: [
        stockBalances.warehouseId,
        stockBalances.locationId,
        stockBalances.productId,
      ],
    }),
    check(
      'movement_quantity_range',
      sql`${t.quantity} between 1 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`,
    ),
    check('movement_receipt_kind', sql`${t.kind} = 'receipt'`),
  ],
);
