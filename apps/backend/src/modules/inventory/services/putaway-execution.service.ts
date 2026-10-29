/** @file Выполнение размещения целиком: receiving → storage одного склада; balance/movements/task/audit/outbox — один commit вызывающего. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { isUuid } from '../../../shared/validation/identifiers';
import { CommandError } from '../../../shared/errors/command-error';
import { AuditService } from '../../audit/services/audit.service';
import { WarehousesService } from '../../warehouses/services/warehouses.service';
import { OutboxService } from '../../../infrastructure/outbox/services/outbox.service';
import { PutawayRepository } from '../repositories/putaway.repository';
import { StockTransferRepository } from '../repositories/stock-transfer.repository';
import type { PutawayTaskDto } from '../dto/putaway-task.dto';
/** Private сценарий inventory; HTTP авторизацию выполняет adapter до idempotency replay. */
@Injectable()
export class PutawayExecutionService {
  /** Только собственные repositories и публичные сервисы владельцев; без pool/runner/внешнего I/O. */
  constructor(
    private readonly tasks: PutawayRepository,
    private readonly transfers: StockTransferRepository,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}
  /** Borrowed read для авторизации по сохранённому warehouse; lock task нужен позже в execute. */
  async read(context: TransactionContext, id: string): Promise<PutawayTaskDto> {
    if (!isUuid(id)) throw new CommandError('VALIDATION_FAILED');
    const task = await this.tasks.findById(context, id.toLowerCase());
    if (!task) throw new CommandError('PUTAWAY_TASK_NOT_FOUND');
    return task;
  }
  /**
   * Количество/источник берутся из task, клиент выбирает только UUID storage назначения.
   * Task lock сериализует разные HTTP keys; новый key на completed →409, исходный key replay обрабатывает HTTP framework.
   * @throws INVALID_PUTAWAY_LOCATION для неверной зоны; LOCATION_NOT_FOUND для чужого склада.
   * @throws Любая SQL/audit/outbox ошибка должна полностью откатить context, включая уже выполненный debit.
   */
  async execute(
    context: TransactionContext,
    id: string,
    targetId: string,
    metadata: OperationMetadata,
  ): Promise<PutawayTaskDto> {
    if (!isUuid(id) || !isUuid(targetId)) throw new CommandError('VALIDATION_FAILED');
    const task = await this.tasks.findById(context, id.toLowerCase(), true);
    if (!task) throw new CommandError('PUTAWAY_TASK_NOT_FOUND');
    if (task.status !== 'pending') throw new CommandError('PUTAWAY_ALREADY_COMPLETED');
    const targetLocationId = targetId.toLowerCase();
    const source = await this.warehouses.requireLocation(
      context,
      task.warehouseId,
      task.sourceLocationId,
    );
    const target = await this.warehouses.requireLocation(
      context,
      task.warehouseId,
      targetLocationId,
    );
    if (source.kind !== 'receiving' || target.kind !== 'storage' || source.id === target.id)
      throw new CommandError('INVALID_PUTAWAY_LOCATION');
    await this.transfers.transfer(context, task, targetLocationId);
    const auditId = await this.audit.write(context, {
      ...metadata,
      action: 'inventory.putaway-completed',
      entityType: 'putaway-task',
      entityId: task.id,
      changes: {
        status: { before: 'pending', after: 'completed' },
        quantity: { after: task.quantity },
        warehouseId: { after: task.warehouseId },
        productId: { after: task.productId },
        sourceLocationId: { after: task.sourceLocationId },
        targetLocationId: { after: targetLocationId },
      },
    });
    await this.transfers.appendPair(context, task, targetLocationId, auditId);
    const completedAt = new Date().toISOString();
    const event = await this.outbox.append(context, {
      type: 'inventory.putaway-completed',
      schemaVersion: 1,
      aggregateType: 'putaway-task',
      aggregateId: task.id,
      occurredAt: completedAt,
      correlationId: metadata.correlationId,
      causationId: task.sourceEventId,
      payload: {
        taskId: task.id,
        receiptId: task.sourceReceiptId,
        receiptLineId: task.sourceReceiptLineId,
        warehouseId: task.warehouseId,
        sourceLocationId: task.sourceLocationId,
        targetLocationId,
        productId: task.productId,
        quantity: task.quantity,
        transferId: task.id,
      },
    });
    // State guard проверяет неизменность source и наличие обоих movements/event до UPDATE.
    return this.tasks.complete(
      context,
      task.id,
      targetLocationId,
      completedAt,
      event.eventId,
      auditId,
    );
  }
}
