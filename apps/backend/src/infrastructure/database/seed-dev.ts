/** @file Dev-only CLI fixtures: guard до подключения, одна транзакция, закрытие Nest/pool в finally. */
import { logEvent, nestLogger } from '../logging/runtime-logger';
import '../logging/startup';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { WarehousesModule } from '../../modules/warehouses/warehouses.module';
/** Seed не поднимает HTTP/auth graph: CLI справочников не требует session policy. */
@Module({ imports: [DatabaseModule, CatalogModule, WarehousesModule] })
class DevFixturesModule {}
import { loadEnvironment } from '../config/environment';
import { TRANSACTION_RUNNER, TransactionRunner } from '../../shared/transactions/transaction.port';
import { CatalogService } from '../../modules/catalog/services/catalog.service';
import { WarehousesService } from '../../modules/warehouses/services/warehouses.service';
import { createDevWarehouseFixtures } from './dev-fixtures';

/** Отдельный dev seed, не startup hook: каждый вызов создаёт новый набор, остатки не меняет. */
async function main(): Promise<void> {
  if (loadEnvironment().nodeEnv !== 'development')
    throw new Error('Dev fixtures require development');
  const app = await NestFactory.createApplicationContext(DevFixturesModule, {
    // Framework пишет в общий stderr; stdout остаётся протоколом результата CLI.
    logger: nestLogger,
    abortOnError: false,
  });
  try {
    const fixture = await app
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((context) =>
        createDevWarehouseFixtures(context, app.get(CatalogService), app.get(WarehousesService)),
      );
    process.stdout.write(
      JSON.stringify({
        productId: fixture.product.id,
        warehouseId: fixture.warehouse.id,
        receivingLocationId: fixture.receiving.id,
        storageLocationId: fixture.storage.id,
        shippingLocationId: fixture.shipping.id,
      }) + '\n',
    );
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  logEvent('seed.failed');
  process.exitCode = 1;
});
