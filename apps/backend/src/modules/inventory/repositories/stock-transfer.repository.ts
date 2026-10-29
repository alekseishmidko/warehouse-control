/** @file SQL переноса внутри inventory: стабильный порядок создания/блокировки двух balances и парные immutable movements. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { CommandError } from '../../../shared/errors/command-error';
import { MAX_STOCK_QUANTITY } from '../../../shared/quantities/quantity';
import type { PutawayTaskDto } from '../dto/putaway-task.dto';
import { stockMovements } from '../inventory.schema';
/** Private provider: вызывается только владельцем полного task execution с borrowed context. */
@Injectable()
export class StockTransferRepository {
  /**
   * Создаёт отсутствующие нулевые позиции и lock-ит в одинаковом порядке ключей, включая absent-key race.
   * UPDATE выполняются только после получения обоих locks; reserved не меняется.
   * @throws INSUFFICIENT_STOCK если свободного источника не хватает; STOCK_LIMIT_EXCEEDED при overflow назначения.
   * SQL ошибка между debit/credit обязательно выходит в runner: частичный commit запрещён.
   */
  async transfer(
    context: TransactionContext,
    task: PutawayTaskDto,
    targetLocationId: string,
  ): Promise<void> {
    const tx = transactionClient(context);
    const balances = new Map<string, { on_hand: number; reserved: number }>();
    // Warehouse/product одинаковы. Поэтому достаточно сортировки lowercase location UUID по ASCII.
    // INSERT и SELECT следуют одному порядку: сортировать только существующие rows недостаточно.
    for (const locationId of [task.sourceLocationId, targetLocationId].sort()) {
      await tx.execute(sql`insert into stock_balances(warehouse_id,location_id,product_id)
        values(${task.warehouseId},${locationId},${task.productId}) on conflict(warehouse_id,location_id,product_id) do nothing`);
      const result = await tx.execute<{
        on_hand: number;
        reserved: number;
      }>(sql`select on_hand,reserved from stock_balances
        where warehouse_id=${task.warehouseId} and location_id=${locationId} and product_id=${task.productId} for update`);
      balances.set(locationId, result.rows[0]);
    }
    const source = balances.get(task.sourceLocationId)!;
    const target = balances.get(targetLocationId)!;
    if (source.on_hand - source.reserved < task.quantity)
      throw new CommandError('INSUFFICIENT_STOCK');
    if (target.on_hand > MAX_STOCK_QUANTITY - task.quantity)
      throw new CommandError('STOCK_LIMIT_EXCEEDED');
    await tx.execute(sql`update stock_balances set on_hand=on_hand-${task.quantity}
      where warehouse_id=${task.warehouseId} and location_id=${task.sourceLocationId} and product_id=${task.productId}`);
    await tx.execute(sql`update stock_balances set on_hand=on_hand+${task.quantity}
      where warehouse_id=${task.warehouseId} and location_id=${targetLocationId} and product_id=${task.productId}`);
  }
  /** Одна положительная запись каждого направления с общим transferId=taskId и completion audit; не открывает транзакций. */
  async appendPair(
    context: TransactionContext,
    task: PutawayTaskDto,
    targetLocationId: string,
    auditId: string,
  ): Promise<void> {
    await transactionClient(context)
      .insert(stockMovements)
      .values([
        {
          operationId: randomUUID(),
          transferId: task.id,
          kind: 'transfer-out',
          warehouseId: task.warehouseId,
          locationId: task.sourceLocationId,
          productId: task.productId,
          quantity: task.quantity,
          auditId,
        },
        {
          operationId: randomUUID(),
          transferId: task.id,
          kind: 'transfer-in',
          warehouseId: task.warehouseId,
          locationId: targetLocationId,
          productId: task.productId,
          quantity: task.quantity,
          auditId,
        },
      ]);
  }
}
