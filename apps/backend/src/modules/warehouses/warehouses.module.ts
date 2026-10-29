/** @file WarehousesModule: экспорт сервиса, repository private, нет публичных CRUD endpoints. */
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WarehousesService } from './services/warehouses.service';
import { WarehousesRepository } from './repositories/warehouses.repository';
/** Предоставляет складские справочники другим сервисам через DI. */
@Module({
  imports: [AuditModule],
  providers: [WarehousesRepository, WarehousesService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
