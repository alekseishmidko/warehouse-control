/** @file Allocation принадлежит inventory: активное обеспечение строки заказа на конкретном balance, история release сохраняется. */
import { pgTable, uuid, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orderLines } from '../../fulfillment/schemas/orders.schema';
import { stockBalances } from '../inventory.schema';
/** Custom migration 0024 индексирует line_id (history/line sum) и balance_id (reconciliation);
 * deferred triggers сверяют ledger на COMMIT после отдельных balance/allocated statements.
 * Нет TTL и каскадного удаления; закрытый allocation не переоткрывается. */
export const allocations = pgTable(
  'stock_allocations',
  {
    /** UUID новой allocation, PK без NULL/default. */ id: uuid('id').primaryKey(),
    /** FK строки заказа; принадлежность склада/SKU проверяет service. */ lineId: uuid('line_id')
      .notNull()
      .references(() => orderLines.id),
    /** FK физической позиции storage. */ balanceId: uuid('balance_id')
      .notNull()
      .references(() => stockBalances.id),
    /** Исходное положительное int4 количество. */ allocated: integer('allocated').notNull(),
    /** Активное int4 количество 0..allocated, без default. */ active: integer('active').notNull(),
    /** Накопленное освобождение int4, default 0; запись не удаляется. */ released: integer(
      'released',
    )
      .notNull()
      .default(0),
  },
  (t) => [
    check(
      'allocation_quantities',
      sql`${t.allocated}>0 and ${t.active}>=0 and ${t.released}>=0 and ${t.allocated}=${t.active}+${t.released}`,
    ),
  ],
);
