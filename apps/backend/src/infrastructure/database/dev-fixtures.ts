/** @file Общий dev/test builder: один товар, склад и три зоны через сервисы владельцев; без stock начисления. */
import { randomUUID } from 'node:crypto';
import type { TransactionContext } from '../../shared/transactions/transaction.port';
import type { CatalogService } from '../../modules/catalog/services/catalog.service';
import type { WarehousesService } from '../../modules/warehouses/services/warehouses.service';

/** Создаёт новый синтетический набор в существующей транзакции; unique suffix исключает пересечение наборов. */
export async function createDevWarehouseFixtures(
  context: TransactionContext,
  catalog: CatalogService,
  warehouses: WarehousesService,
) {
  const suffix = randomUUID();
  const metadata = {
    actorType: 'system' as const,
    actorId: randomUUID(),
    correlationId: randomUUID(),
    reasonCode: 'dev-fixture',
  };
  const product = await catalog.create(context, {
    ...metadata,
    sku: `DEV-${suffix}`,
    name: 'Demo product',
  });
  const warehouse = await warehouses.createWarehouse(context, {
    ...metadata,
    code: `DEV-${suffix}`,
    name: 'Demo warehouse',
  });
  const receiving = await warehouses.createLocation(context, {
    ...metadata,
    warehouseId: warehouse.id,
    code: 'RECEIVING',
    kind: 'receiving',
  });
  const storage = await warehouses.createLocation(context, {
    ...metadata,
    warehouseId: warehouse.id,
    code: 'STORAGE',
    kind: 'storage',
  });
  const shipping = await warehouses.createLocation(context, {
    ...metadata,
    warehouseId: warehouse.id,
    code: 'SHIPPING',
    kind: 'shipping',
  });
  return { metadata, product, warehouse, receiving, storage, shipping };
}
