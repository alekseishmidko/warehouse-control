/** @file Inventory policy физической отгрузки/возврата: только shipping своего заказа, без новых резервов. */
import type { ShippingAllocationCommand } from '../dto/shipping-allocation-command.dto';
import { Injectable } from '@nestjs/common';
import {
  ShippingStockRepository,
  ShippingEffectInput,
} from '../repositories/shipping-stock.repository';
import { WarehousesService } from '../../warehouses/services/warehouses.service';
import { AuditService } from '../../audit/services/audit.service';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { requirePositiveQuantity } from '../../../shared/quantities/quantity';
import { CommandError } from '../../../shared/errors/command-error';
/** Внутренний сервис; caller удерживает order lock и проверяет жизненный цикл документа. */
@Injectable()
export class ShippingStockService {
  /** DI сервисов владельцев; нет I/O в constructor. */
  constructor(
    private readonly repository: ShippingStockRepository,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}
  /** Проводит полный вектор или бросает ошибку до runner. Metadata — только server principal и проверенная причина. */
  async applyShippingEffects(
    c: TransactionContext,
    orderId: string,
    kind: 'ship' | 'return',
    items: ShippingAllocationCommand[],
    m: OperationMetadata,
  ) {
    if (!items.length || new Set(items.map((i) => i.allocationId)).size !== items.length)
      throw new CommandError('VALIDATION_FAILED');
    const entries: ShippingEffectInput[] = [];
    for (const i of items) {
      requirePositiveQuantity(i.quantity);
      const source = await this.repository.findSource(c, i.allocationId);
      if (!source || source.order_id !== orderId || source.kind !== 'shipping')
        throw new CommandError('VALIDATION_FAILED');
      if (kind === 'return') {
        const target = await this.warehouses.requireLocation(
          c,
          source.warehouse_id,
          i.targetLocationId!,
        );
        if (target.kind !== 'storage' || source.active !== i.quantity)
          throw new CommandError('VALIDATION_FAILED');
      }
      const auditId = await this.audit.write(c, {
        ...m,
        entityType: 'allocation',
        entityId: source.id,
        action: kind === 'ship' ? 'inventory.stock-shipped' : 'inventory.stock-returned',
        changes: { quantity: { after: i.quantity } },
      });
      entries.push({ source, ...i, auditId });
    }
    await this.repository.applyEffects(c, kind, entries);
  }
}
