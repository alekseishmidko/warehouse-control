/** @file InventoryService — единственный владелец начисления: validation, справочники, balance+audit+movement. */
import { Injectable } from '@nestjs/common';
import { CommandError } from '../../../shared/errors/command-error';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { requirePositiveQuantity } from '../../../shared/quantities/quantity';
import { requireUuid } from '../../../shared/validation/identifiers';
import { AuditService } from '../../audit/services/audit.service';
import { CatalogService } from '../../catalog/services/catalog.service';
import { WarehousesService } from '../../warehouses/services/warehouses.service';
import { InventoryRepository } from '../repositories/inventory.repository';
import type { ReceiveStockDto, ReceiveStockResultDto, StockKeyDto, StockBalanceDto } from '../dto/stock.dto';
/** Внутренний service, не HTTP CRUD; событие документа пишет receiving, reservations ещё нет. */
@Injectable()
export class InventoryService {
  /** Внедряет свой repository и публичные сервисы catalog/warehouses/audit для одной транзакции. */
  constructor(private readonly repository: InventoryRepository, private readonly catalog: CatalogService,
    private readonly warehouses: WarehousesService, private readonly audit: AuditService) {}
  /** Приход только в receiving location; не открывает/не коммитит transaction, все ошибки должны выйти в runner. */
  async receive(context: TransactionContext, input: ReceiveStockDto): Promise<ReceiveStockResultDto> {
    requirePositiveQuantity(input.quantity); requireUuid(input.operationId, 'operationId');
    await this.catalog.requireProduct(context, input.productId);
    const location = await this.warehouses.requireLocation(context, input.warehouseId, input.locationId);
    if (location.kind !== 'receiving') throw new CommandError('INVALID_RECEIVING_LOCATION');
    const balance = await this.repository.credit(context, input);
    const auditId = await this.audit.write(context, { ...input, action: 'inventory.stock-received', entityType: 'stock-balance', entityId: balance.id,
      changes: { onHand: { before: balance.onHand - input.quantity, after: balance.onHand }, quantity: { after: input.quantity },
        productId: { after: input.productId }, warehouseId: { after: input.warehouseId }, locationId: { after: input.locationId } } });
    const movementId = await this.repository.appendMovement(context, input, auditId);
    return { balance, movementId, auditId };
  }
  /** Читает баланс после проверки владельцев справочников; будущие access guards находятся вне этого внутреннего API. */
  async getBalance(context: TransactionContext, key: StockKeyDto): Promise<StockBalanceDto | null> {
    await this.catalog.requireProduct(context, key.productId);
    await this.warehouses.requireLocation(context, key.warehouseId, key.locationId);
    return this.repository.findBalance(context, key);
  }
}
