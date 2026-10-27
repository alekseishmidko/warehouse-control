/** @file Синтетическая проведённая приёмка через production owners, без прямого stock/task SQL и копирования правил. */
import type { INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TRANSACTION_RUNNER, TransactionRunner } from '@backend/shared/transactions/transaction.port';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
/** Создаёт новый набор refs и receipt в одной transaction; worker/task намеренно не запускает. */
export async function postedReceiptFixture(app: INestApplicationContext, quantity = 10, lineCount = 1) {
  return app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async context => {
    const catalog = app.get(CatalogService); const receiving = app.get(ReceivingService);
    const fixture = await createDevWarehouseFixtures(context, catalog, app.get(WarehousesService));
    const lines = [{ productId: fixture.product.id, quantity }];
    for (let i = 1; i < lineCount; i++) {
      const product = await catalog.create(context, { ...fixture.metadata, sku: `TASK-${randomUUID()}`, name: 'Task test product' });
      lines.push({ productId: product.id, quantity });
    }
    const draft = await receiving.create(context, { warehouseId: fixture.warehouse.id, receivingLocationId: fixture.receiving.id, lines }, fixture.metadata);
    return { fixture, document: await receiving.post(context, draft.id, fixture.metadata) };
  });
}
