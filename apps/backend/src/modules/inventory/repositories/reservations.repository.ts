/** @file Inventory SQL резервов: balance locks по product/location, allocations и reserved изменяются совместно. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { CommandError } from '../../../shared/errors/command-error';
/** Private provider. Order lock уже держит вызывающий fulfillment. */
@Injectable()
export class ReservationsRepository {
  /** Активные allocations строки, включая историю для GET; не открывает транзакцию. */
  async list(c: TransactionContext, lineId: string) {
    return (
      await transactionClient(c).execute<{
        id: string;
        balance_id: string;
        allocated: number;
        active: number;
        released: number;
      }>(
        sql`select a.* from stock_allocations a join stock_balances b on b.id=a.balance_id where a.line_id=${lineId} order by b.product_id,b.location_id,a.id`,
      )
    ).rows;
  }
  /** Количество запрашивается явно; нехватка на любой строке должна выйти до общего runner. */
  async reserve(
    c: TransactionContext,
    warehouseId: string,
    lineId: string,
    productId: string,
    quantity: number,
  ) {
    const tx = transactionClient(c);
    // Без SKIP LOCKED: занятая позиция не считается отсутствующим stock. Новый snapshot после ожидания row lock.
    const rows = (
      await tx.execute<{ id: string; on_hand: number; reserved: number }>(
        sql`select b.* from stock_balances b join locations l on l.id=b.location_id where b.warehouse_id=${warehouseId} and b.product_id=${productId} and l.kind='storage' order by b.location_id for update of b`,
      )
    ).rows;
    let remaining = quantity;
    for (const row of rows) {
      const take = Math.min(remaining, row.on_hand - row.reserved);
      if (take <= 0) continue;
      await tx.execute(sql`update stock_balances set reserved=reserved+${take} where id=${row.id}`);
      await tx.execute(
        sql`insert into stock_allocations(id,line_id,balance_id,allocated,active) values(${randomUUID()},${lineId},${row.id},${take},${take})`,
      );
      remaining -= take;
      if (!remaining) break;
    }
    if (remaining) throw new CommandError('INSUFFICIENT_STOCK');
  }
  /** Release только storage allocation своего line; balance lock предшествует update allocation, история сохраняется. */
  async release(c: TransactionContext, lineId: string, id: string, quantity: number) {
    const tx = transactionClient(c);
    const a = (
      await tx.execute<{ balance_id: string; active: number }>(
        sql`select * from stock_allocations where id=${id} and line_id=${lineId}`,
      )
    ).rows[0];
    if (!a || quantity <= 0 || quantity > a.active) throw new CommandError('VALIDATION_FAILED');
    const b = (
      await tx.execute<{ id: string }>(
        sql`select b.id from stock_balances b join locations l on l.id=b.location_id where b.id=${a.balance_id} and l.kind='storage' for update of b`,
      )
    ).rows[0];
    if (!b) throw new CommandError('VALIDATION_FAILED');
    await tx.execute(
      sql`update stock_balances set reserved=reserved-${quantity} where id=${a.balance_id}`,
    );
    await tx.execute(
      sql`update stock_allocations set active=active-${quantity},released=released+${quantity} where id=${id}`,
    );
  }
}
