/** @file Проверка физической сборки: только storage → shipping одного склада, без повторного резервирования. */
import { Injectable } from '@nestjs/common';
import { PickingStockRepository } from '../repositories/picking-stock.repository';
import { WarehousesService } from '../../warehouses/services/warehouses.service';
import { AuditService } from '../../audit/services/audit.service';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { requirePositiveQuantity } from '../../../shared/quantities/quantity';
import { CommandError } from '../../../shared/errors/command-error';
/** Внутренний сервис inventory, публичный интерфейс предоставлен InventoryService. */
@Injectable()
export class PickingStockService {
  /** Внедряет сервисы владельцев и внутренний repository; создание экземпляра не выполняет I/O. */
  constructor(
    private readonly repository: PickingStockRepository,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}
  /** Проверяет сохранённый источник и назначение; audit, balances, allocations и movements используют один context. */
  async pickReservedQuantity(
    c: TransactionContext,
    allocationId: string,
    targetLocationId: string,
    quantity: number,
    taskLineId: string,
    m: OperationMetadata,
  ) {
    requirePositiveQuantity(quantity);
    const source = await this.repository.findAllocationSource(c, allocationId);
    if (!source || source.kind !== 'storage') throw new CommandError('VALIDATION_FAILED');
    const target = await this.warehouses.requireLocation(
      c,
      source.warehouse_id,
      targetLocationId.toLowerCase(),
    );
    if (target.kind !== 'shipping') throw new CommandError('VALIDATION_FAILED');
    const auditId = await this.audit.write(c, {
      ...m,
      entityType: 'allocation',
      entityId: allocationId,
      action: 'inventory.reserved-stock-picked',
      changes: { quantity: { after: quantity }, locationId: { after: target.id } },
    });
    await this.repository.transferReservedQuantity(
      c,
      source,
      target.id,
      quantity,
      taskLineId,
      auditId,
    );
  }
}
