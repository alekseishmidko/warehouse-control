/** @file Receiving composition: controller/service/repository и публичные зависимости владельцев данных. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReceivingController } from './receiving.controller';
import { ReceivingService } from './services/receiving.service';
import { ReceivingRepository } from './repositories/receiving.repository';
/** Экспортируется только сервис документа; SQL adapter остаётся внутренним provider. */
@Module({ imports: [DatabaseModule, IdempotencyModule, OutboxModule, AuditModule, CatalogModule, WarehousesModule, InventoryModule],
  controllers: [ReceivingController], providers: [ReceivingService, ReceivingRepository], exports: [ReceivingService] })
export class ReceivingModule {}
