/** @file InventoryModule: единственный экспорт InventoryService; repositories других модулей не импортируются. */
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
  imports: [AuditModule, CatalogModule, WarehousesModule],
  providers: [InventoryRepository, PutawayRepository, PutawayService, InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
