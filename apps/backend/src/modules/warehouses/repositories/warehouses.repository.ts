/** @file Warehouses SQL: только собственные таблицы, общий transaction context, без commit. */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { warehouses, locations } from '../warehouses.schema';
import type { LocationDto, LocationKind, WarehouseDto } from '../dto/warehouse.dto';
/** Внутренний provider владельца склада/ячеек. */
@Injectable()
export class WarehousesRepository {
  /** Создаёт склад, unique violation не скрывается. */
  async createWarehouse(context: TransactionContext, code: string, name: string): Promise<WarehouseDto> {
    const [row] = await transactionClient(context).insert(warehouses).values({ code, name }).returning(); return row;
  }
  /** Создаёт ячейку, FK защищает существование склада. */
  async createLocation(context: TransactionContext, warehouseId: string, code: string, kind: LocationKind): Promise<LocationDto> {
    const [row] = await transactionClient(context).insert(locations).values({ warehouseId, code, kind }).returning(); return row;
  }
  /** Читает ячейку; warehouse ownership проверяется сервисом и composite FK. */
  async findLocation(context: TransactionContext, id: string): Promise<LocationDto | null> {
    const [row] = await transactionClient(context).select().from(locations).where(eq(locations.id, id)).limit(1); return row ?? null;
  }
}
