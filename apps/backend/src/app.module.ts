/** @file Корневой composition root: связывает технический HTTP, PostgreSQL и внутренние складские модули. */
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { Module } from '@nestjs/common';
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
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
