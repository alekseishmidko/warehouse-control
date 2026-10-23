/** @file WarehousesService: создание с audit и проверка принадлежности/назначения ячейки для inventory. */
import { Injectable } from '@nestjs/common';
import { CommandError } from '../../../shared/errors/command-error';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { requireUuid } from '../../../shared/validation/identifiers';
import { normalizeCode, normalizeName } from '../../../shared/validation/resource-fields';
import { AuditService } from '../../audit/services/audit.service';
import { WarehousesRepository } from '../repositories/warehouses.repository';
import type { CreateWarehouseDto, CreateLocationDto, WarehouseDto, LocationDto } from '../dto/warehouse.dto';
/** Экспортируемый владелец справочника складов; внутренних SQL наружу не выдаёт. */
@Injectable()
export class WarehousesService {
  /** Внедряет собственный repository и AuditService; других repositories не использует. */
  constructor(private readonly repository: WarehousesRepository, private readonly audit: AuditService) {}
  /** Склад и audit создаются атомарно с вызывающим сценарием. */
  async createWarehouse(context: TransactionContext, input: CreateWarehouseDto): Promise<WarehouseDto> {
    const row = await this.repository.createWarehouse(context, normalizeCode(input.code, 'warehouse code'), normalizeName(input.name));
    await this.audit.write(context, { ...input, action: 'warehouses.warehouse-created', entityType: 'warehouse', entityId: row.id }); return row;
  }
  /** Ячейка с корректным kind, FK/unique и audit; не создаёт вторую транзакцию. */
  async createLocation(context: TransactionContext, input: CreateLocationDto): Promise<LocationDto> {
    requireUuid(input.warehouseId, 'warehouseId');
    if (!['receiving', 'storage', 'shipping'].includes(input.kind)) throw new Error('Invalid location kind');
    const row = await this.repository.createLocation(context, input.warehouseId, normalizeCode(input.code, 'location code'), input.kind);
    await this.audit.write(context, { ...input, action: 'warehouses.location-created', entityType: 'location', entityId: row.id,
      changes: { warehouseId: { after: row.warehouseId }, locationId: { after: row.id } } }); return row;
  }
  /** Возвращает ячейку только существующего указанного склада, иначе LOCATION_NOT_FOUND; caller доверенный. */
  async requireLocation(context: TransactionContext, warehouseId: string, locationId: string): Promise<LocationDto> {
    requireUuid(warehouseId, 'warehouseId'); requireUuid(locationId, 'locationId');
    const location = await this.repository.findLocation(context, locationId);
    if (!location || location.warehouseId !== warehouseId) throw new CommandError('LOCATION_NOT_FOUND'); return location;
  }
}
