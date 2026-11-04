/** @file InventoryModule: экспортирует InventoryService и InventoryReadService; repositories других модулей не импортируются. */
import { InventoryReadRepository } from './repositories/inventory-read.repository';
import { InventoryReadService } from './services/inventory-read.service';
import { ShippingStockService } from './services/shipping-stock.service';
import { ShippingStockRepository } from './repositories/shipping-stock.repository';
import { PickingStockService } from './services/picking-stock.service';
import { PickingStockRepository } from './repositories/picking-stock.repository';
import { ReservationsService } from './services/reservations.service';
import { ReservationsRepository } from './repositories/reservations.repository';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { StockTransferRepository } from './repositories/stock-transfer.repository';
import { PutawayExecutionService } from './services/putaway-execution.service';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoryService } from './services/inventory.service';
import { InventoryRepository } from './repositories/inventory.repository';
import { PutawayRepository } from './repositories/putaway.repository';
import { PutawayService } from './services/putaway.service';
/** Подключает публичные сервисы владельцев, без HTTP-контроллеров. */
@Module({
  imports: [AuditModule, CatalogModule, WarehousesModule, OutboxModule],
  providers: [
    InventoryReadRepository,
    InventoryReadService,
    ShippingStockService,
    ShippingStockRepository,
    PickingStockService,
    PickingStockRepository,
    ReservationsService,
    ReservationsRepository,
    StockTransferRepository,
    PutawayExecutionService,
    InventoryRepository,
    PutawayRepository,
    PutawayService,
    InventoryService,
  ],
  exports: [InventoryReadService, InventoryService],
})
export class InventoryModule {}
