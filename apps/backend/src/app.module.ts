/** @file Корневой composition root: связывает технический HTTP, PostgreSQL и внутренние складские модули. */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { InventoryModule } from './modules/inventory/inventory.module';

/** Регистрирует HTTP-каркас и PostgreSQL; минимальные catalog/warehouses/inventory без HTTP CRUD. */
@Module({
  imports: [DatabaseModule, AuditModule, CatalogModule, WarehousesModule, InventoryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
