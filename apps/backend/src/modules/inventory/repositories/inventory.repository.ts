/** @file Inventory SQL: атомарный guarded upsert без lost update и INSERT immutable movement. */
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { MAX_STOCK_QUANTITY } from '../../../shared/quantities/quantity';
import { stockBalances, stockMovements } from '../inventory.schema';
import type { StockKeyDto, StockBalanceDto, ReceiveStockDto } from '../dto/stock.dto';
/** Private provider; изменять balances можно только через InventoryService. */
@Injectable()
export class InventoryRepository {
  /** Concurrent absent-key INSERT сериализуется unique/upsert; overflow отклоняется до integer addition. */
  async credit(context: TransactionContext, input: ReceiveStockDto): Promise<StockBalanceDto> {
    const [row] = await transactionClient(context).insert(stockBalances).values({
      warehouseId: input.warehouseId, locationId: input.locationId, productId: input.productId, onHand: input.quantity,
    }).onConflictDoUpdate({
      target: [stockBalances.warehouseId, stockBalances.locationId, stockBalances.productId],
      set: { onHand: sql`${stockBalances.onHand} + ${input.quantity}` },
      setWhere: sql`${stockBalances.onHand} <= ${MAX_STOCK_QUANTITY - input.quantity}`,
    }).returning();
    if (!row) throw new Error('Stock quantity limit exceeded'); return row;
  }
  /** Movement и balance принадлежат тому же context; повтор operationId отклоняется unique constraint. */
  async appendMovement(context: TransactionContext, input: ReceiveStockDto, auditId: string): Promise<string> {
    const [row] = await transactionClient(context).insert(stockMovements).values({
      operationId: input.operationId, warehouseId: input.warehouseId, locationId: input.locationId,
      productId: input.productId, quantity: input.quantity, auditId,
    }).returning({ id: stockMovements.id }); return row.id;
  }
  /** Внутреннее чтение текущего баланса; не является публичным stock API. */
  async findBalance(context: TransactionContext, key: StockKeyDto): Promise<StockBalanceDto | null> {
    const [row] = await transactionClient(context).select().from(stockBalances).where(and(
      eq(stockBalances.warehouseId, key.warehouseId), eq(stockBalances.locationId, key.locationId), eq(stockBalances.productId, key.productId),
    )).limit(1); return row ?? null;
  }
}
