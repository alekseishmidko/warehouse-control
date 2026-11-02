/** @file Fulfillment API composition: controller → service → private repository, inventory — публичный владелец резервов. */
import { PickingController } from './picking.controller';
import { PickingService } from './services/picking.service';
import { PickingRepository } from './repositories/picking.repository';
import { Module } from '@nestjs/common';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './services/fulfillment.service';
import { OrdersRepository } from './repositories/orders.repository';
import { InventoryModule } from '../inventory/inventory.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
/** Worker этот API graph не импортирует. */
@Module({
  imports: [
    InventoryModule,
    CatalogModule,
    AuditModule,
    IdentityModule,
    OutboxModule,
    IdempotencyModule,
  ],
  controllers: [FulfillmentController, PickingController],
  providers: [FulfillmentService, OrdersRepository, PickingService, PickingRepository],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
