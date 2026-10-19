/** @file Dev-only CLI fixtures: guard до подключения, одна транзакция, закрытие Nest/pool в finally. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { loadEnvironment } from '../config/environment';
import { TRANSACTION_RUNNER, TransactionRunner } from '../../shared/transactions/transaction.port';
import { CatalogService } from '../../modules/catalog/services/catalog.service';
import { WarehousesService } from '../../modules/warehouses/services/warehouses.service';
import { createDevWarehouseFixtures } from './dev-fixtures';

/** Отдельный dev seed, не startup hook: каждый вызов создаёт новый набор, остатки не меняет. */
async function main(): Promise<void> {
  if (loadEnvironment().nodeEnv !== 'development') throw new Error('Dev fixtures require development');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  try {
    const fixture = await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(context =>
      createDevWarehouseFixtures(context, app.get(CatalogService), app.get(WarehousesService)));
    console.log(JSON.stringify({ productId: fixture.product.id, warehouseId: fixture.warehouse.id,
      receivingLocationId: fixture.receiving.id, storageLocationId: fixture.storage.id, shippingLocationId: fixture.shipping.id }));
  } finally { await app.close(); }
}

void main().catch(() => {
  console.error('Dev fixtures failed. Require development mode, database availability and applied migrations.');
  process.exitCode = 1;
});
