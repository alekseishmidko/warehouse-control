/** @file SQL физической сборки: один context, стабильный порядок balances, сохранение истории allocation и пары движений. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import { CommandError } from '../../../shared/errors/command-error';
/** Private inventory provider. Parent order/task уже заблокированы владельцем сценария. */
@Injectable()
export class PickingStockRepository {
  /** Возвращает сохранённый источник, а не доверяет source/SKU/warehouse из HTTP. */
  async findAllocationSource(c: TransactionContext, id: string) {
    return (
      await transactionClient(c).execute<{
        id: string;
        line_id: string;
        balance_id: string;
        active: number;
        warehouse_id: string;
        product_id: string;
        location_id: string;
        kind: string;
      }>(
        sql`select a.*,b.warehouse_id,b.product_id,b.location_id,l.kind from stock_allocations a join stock_balances b on b.id=a.balance_id join locations l on l.id=b.location_id where a.id=${id}`,
      )
    ).rows[0];
  }
  /**
   * Переносит положительную фактическую часть. Ошибка любого SQL должна выйти до общего runner.
   * После ожидания двух locks перечитывает allocation; не использует устаревший active для арифметики.
   */
  async transferReservedQuantity(
    c: TransactionContext,
    source: NonNullable<Awaited<ReturnType<PickingStockRepository['findAllocationSource']>>>,
    targetLocationId: string,
    quantity: number,
    taskLineId: string,
    auditId: string,
  ) {
    const tx = transactionClient(c);
    const balances = new Map<string, { id: string; on_hand: number; reserved: number }>();
    // Создание отсутствующей позиции и SELECT следуют одному порядку. Это покрывает absent-key race.
    for (const location of [source.location_id, targetLocationId].sort()) {
      await tx.execute(
        sql`insert into stock_balances(warehouse_id,location_id,product_id) values(${source.warehouse_id},${location},${source.product_id}) on conflict(warehouse_id,location_id,product_id) do nothing`,
      );
      const b = (
        await tx.execute<{ id: string; on_hand: number; reserved: number }>(
          sql`select * from stock_balances where warehouse_id=${source.warehouse_id} and location_id=${location} and product_id=${source.product_id} for update`,
        )
      ).rows[0];
      balances.set(location, b);
    }
    const from = balances.get(source.location_id)!,
      to = balances.get(targetLocationId)!;
    const current = await this.findAllocationSource(c, source.id);
    if (
      !current ||
      current.active < quantity ||
      from.reserved < quantity ||
      from.on_hand < quantity
    )
      throw new CommandError('INSUFFICIENT_STOCK');
    if (to.on_hand > 2147483647 - quantity) throw new CommandError('STOCK_LIMIT_EXCEEDED');
    // onHand и reserved уменьшаются вместе: свободное количество источника не меняется.
    await tx.execute(
      sql`update stock_balances set on_hand=on_hand-${quantity},reserved=reserved-${quantity} where id=${from.id}`,
    );
    await tx.execute(
      sql`update stock_balances set on_hand=on_hand+${quantity},reserved=reserved+${quantity} where id=${to.id}`,
    );
    await tx.execute(
      sql`update stock_allocations set active=active-${quantity},transferred=transferred+${quantity} where id=${source.id}`,
    );
    const targetId = randomUUID(),
      transferId = randomUUID();
    await tx.execute(
      sql`insert into stock_allocations(id,line_id,balance_id,allocated,active) values(${targetId},${source.line_id},${to.id},${quantity},${quantity})`,
    );
    await tx.execute(
      sql`insert into picking_transfers(id,task_line_id,source_allocation_id,target_allocation_id,quantity,audit_id) values(${transferId},${taskLineId},${source.id},${targetId},${quantity},${auditId})`,
    );
    for (const [kind, location] of [
      ['transfer-out', source.location_id],
      ['transfer-in', targetLocationId],
    ])
      await tx.execute(
        sql`insert into stock_movements(operation_id,warehouse_id,location_id,product_id,kind,quantity,picking_transfer_id,audit_id) values(${randomUUID()},${source.warehouse_id},${location},${source.product_id},${kind},${quantity},${transferId},${auditId})`,
      );
  }
}
