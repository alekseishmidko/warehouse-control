/** @file InventoryModule: единственный экспорт InventoryService; repositories других модулей не импортируются. */
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoryService } from './services/inventory.service';
import { InventoryRepository } from './repositories/inventory.repository';
/** Подключает публичные сервисы владельцев, без HTTP-контроллеров. */
@Module({ imports: [AuditModule, CatalogModule, WarehousesModule], providers: [InventoryRepository, InventoryService], exports: [InventoryService] })
export class InventoryModule {}
