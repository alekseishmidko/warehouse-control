/** @file Warehouses SQL: только собственные таблицы, общий transaction context, без commit. */
import { sql } from 'drizzle-orm';
import { readKeysetPage } from '../../../infrastructure/database/read-keyset-page';
import type { PageRequest } from '../../../shared/pagination/keyset-page';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { warehouses, locations } from '../warehouses.schema';
import type { LocationDto, LocationKind, WarehouseDto } from '../dto/warehouse.dto';
/** Внутренний provider владельца склада/ячеек. */
@Injectable()
export class WarehousesRepository {
  /** Список ограничен доверенным набором grants из AccessService, system_admin не даёт implicit доступа. */
  listWarehouses(context: TransactionContext, ids: readonly string[], page: PageRequest) {
    return readKeysetPage<import('../dto/warehouse-read.dto').WarehouseReadDto>(context, page, {
      from: sql`warehouses w`,
      id: sql`w.id`,
      projection: sql`w.id,w.code,w.name`,
      where: ids.length
        ? sql`w.id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`,`,
          )})`
        : sql`false`,
    });
  }
  /** Читает только ячейки проверенного склада; выбор чужого UUID позже также проверяется owner команды. */
  listLocations(context: TransactionContext, warehouseId: string, page: PageRequest) {
    return readKeysetPage<import('../dto/location-read.dto').LocationReadDto>(context, page, {
      from: sql`locations l`,
      id: sql`l.id`,
      projection: sql`l.id,l.warehouse_id as "warehouseId",l.code,l.kind`,
      where: sql`l.warehouse_id=${warehouseId}::uuid`,
    });
  }

  /** Создаёт склад, unique violation не скрывается. */
  async createWarehouse(
    context: TransactionContext,
    code: string,
    name: string,
  ): Promise<WarehouseDto> {
    const [row] = await transactionClient(context)
      .insert(warehouses)
      .values({ code, name })
      .returning();
    return row;
  }
  /** Создаёт ячейку, FK защищает существование склада. */
  async createLocation(
    context: TransactionContext,
    warehouseId: string,
    code: string,
    kind: LocationKind,
  ): Promise<LocationDto> {
    const [row] = await transactionClient(context)
      .insert(locations)
      .values({ warehouseId, code, kind })
      .returning();
    return row;
  }
  /** Читает ячейку; warehouse ownership проверяется сервисом и composite FK. */
  async findLocation(context: TransactionContext, id: string): Promise<LocationDto | null> {
    const [row] = await transactionClient(context)
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    return row ?? null;
  }
}
