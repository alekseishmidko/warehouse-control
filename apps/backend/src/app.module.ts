/** @file Корневой composition root: связывает технический HTTP, PostgreSQL и внутренние складские модули. */
import { DirectoryReadController } from './infrastructure/http/directory-read.controller';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { ProcessHealth } from './infrastructure/lifecycle/process-health';
import { DatabaseService } from './infrastructure/database/database.module';
import { Module } from '@nestjs/common';
import { WarehouseReadController } from './infrastructure/http/warehouse-read.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { InventoryHttpModule } from './modules/inventory/inventory-http.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { HttpModule } from './infrastructure/http/http.module';
import { IdempotencyModule } from './infrastructure/idempotency/idempotency.module';
import { ReceivingModule } from './modules/receiving/receiving.module';

/** Регистрирует HTTP-каркас, PostgreSQL и вертикальный receiving; worker запускается отдельным graph/process. */
@Module({
  imports: [
    IdentityModule,
    FulfillmentModule,
    DatabaseModule,
    AuditModule,
    CatalogModule,
    WarehousesModule,
    InventoryModule,
    InventoryHttpModule,
    OutboxModule,
    HttpModule,
    IdempotencyModule,
    ReceivingModule,
  ],
  controllers: [DirectoryReadController, WarehouseReadController, AppController],
  providers: [
    AppService,
    {
      provide: ProcessHealth,
      useFactory: (database: DatabaseService) => new ProcessHealth(() => database.assertReady()),
      inject: [DatabaseService],
    },
  ],
})
export class AppModule {}
