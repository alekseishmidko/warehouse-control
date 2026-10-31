/** @file Private SQL заказов; stock и allocations изменяет только публичный InventoryService. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { orders, orderLines } from '../schemas/orders.schema';
/** Borrowed context во всех методах, без собственного commit. */
@Injectable()
export class OrdersRepository {
  /** Записывает draft и строки в caller transaction. */
  async create(
    c: TransactionContext,
    id: string,
    warehouseId: string,
    lines: { id: string; productId: string; quantity: number }[],
  ) {
    await transactionClient(c).insert(orders).values({ id, warehouseId });
    await transactionClient(c)
      .insert(orderLines)
      .values(lines.map((l) => ({ ...l, orderId: id })));
  }
  /** Чтение родителя, опционально lock до проверки состояния. */
  async get(c: TransactionContext, id: string, lock: false | true | 'share' = false) {
    return (
      await transactionClient(c).execute<{ id: string; warehouse_id: string; status: string }>(
        sql`select * from orders where id=${id} ${lock === 'share' ? sql`for share` : lock ? sql`for update` : sql``}`,
      )
    ).rows[0];
  }
  /** Возвращает состав, порядок SKU задаёт стабильный порядок будущих stock locks. */
  async lines(c: TransactionContext, id: string) {
    return (
      await transactionClient(c).execute<{ id: string; product_id: string; quantity: number }>(
        sql`select * from order_lines where order_id=${id} order by product_id`,
      )
    ).rows;
  }
  /** Разрешённый lifecycle проверяется сервисом под lock. */
  async state(c: TransactionContext, id: string, status: string) {
    await transactionClient(c).execute(sql`update orders set status=${status} where id=${id}`);
  }
}
