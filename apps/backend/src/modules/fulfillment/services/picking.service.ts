/** @file Сборка заказа: immutable план, самоназначение исполнителя и атомарная фиксация найденного количества. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PickingRepository } from '../repositories/picking.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import { InventoryService } from '../../inventory/services/inventory.service';
import { AuditService } from '../../audit/services/audit.service';
import { OutboxService } from '../../../infrastructure/outbox/services/outbox.service';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { CommandError } from '../../../shared/errors/command-error';
/** Сервис заимствует context HTTP-команды; policy проверяется до idempotency и повторяется для исполнителя. */
@Injectable()
export class PickingService {
  /** Внедряет сервисы владельцев и внутренний repository; создание экземпляра не выполняет I/O. */
  constructor(
    private readonly repository: PickingRepository,
    private readonly orders: OrdersRepository,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}
  /** Читает склад задания до policy, не раскрывая HTTP-клиенту снимок без проверки доступа. */
  async findTaskWarehouse(c: TransactionContext, id: string) {
    const task = await this.repository.findTask(c, id);
    if (!task) throw new CommandError('PICKING_TASK_NOT_FOUND');
    const order = await this.orders.get(c, task.order_id);
    if (!order) throw new CommandError('ORDER_NOT_FOUND');
    return { warehouseId: order.warehouse_id, task };
  }
  /** Текущий снимок, без внутренних SQL имён; remaining вычисляется из сохранённой истории. */
  async readTask(c: TransactionContext, id: string, lockOrder = false) {
    let { warehouseId, task } = await this.findTaskWarehouse(c, id);
    // GET удерживает общий order lock: количества и статус относятся к одному состоянию.
    if (lockOrder) {
      await this.orders.get(c, task.order_id, 'share');
      task = (await this.repository.findTask(c, id))!;
    }
    return {
      id: task.id,
      orderId: task.order_id,
      warehouseId,
      status: task.status,
      assigneeId: task.assignee_id,
      lines: (await this.repository.listLines(c, id)).map((l) => ({
        id: l.id,
        allocationId: l.allocation_id,
        planned: l.planned,
        pickedTotal: l.picked_total,
        cancelledUnpicked: l.cancelled_unpicked,
        remaining: l.planned - l.picked_total - l.cancelled_unpicked,
      })),
    };
  }
  /** Планирует все текущие storage allocations активного заказа. Создание не меняет остатки. */
  async createTaskFromOrder(c: TransactionContext, orderId: string, m: OperationMetadata) {
    const order = await this.orders.get(c, orderId, true);
    if (!order) throw new CommandError('ORDER_NOT_FOUND');
    if (order.status !== 'active' || (await this.repository.hasOpenTask(c, orderId)))
      throw new CommandError('ORDER_STATE_CONFLICT');
    const lines = [];
    for (const line of await this.orders.lines(c, orderId))
      for (const a of await this.inventory.allocations(c, line.id))
        if (a.locationKind === 'storage' && a.active > 0)
          lines.push({ id: randomUUID(), allocationId: a.id, quantity: a.active });
    // Документ ограничен тем же лимитом строк, что и прочие команды; не создаём пустое задание.
    if (!lines.length || lines.length > 1000) throw new CommandError('VALIDATION_FAILED');
    const id = randomUUID();
    await this.repository.createTask(c, id, orderId, lines);
    await this.recordProgress(c, id, orderId, 'created', m);
    return this.readTask(c, id);
  }
  /** Исполнитель берёт ready задание сам. order → task сериализует start, confirm и отмену. */
  async startTask(c: TransactionContext, id: string, actorId: string, m: OperationMetadata) {
    const { task } = await this.findTaskWarehouse(c, id);
    const order = await this.orders.get(c, task.order_id, true);
    const locked = await this.repository.findTask(c, id, true);
    if (order?.status !== 'active' || !locked || !['ready', 'shortage'].includes(locked.status))
      throw new CommandError('ORDER_STATE_CONFLICT');
    // shortage возобновляет только прежний исполнитель. Переназначение не предоставлено этим API.
    if (locked.assignee_id && locked.assignee_id !== actorId) throw new CommandError('FORBIDDEN');
    await this.repository.setTaskState(c, id, 'in_progress', actorId);
    await this.recordProgress(c, id, task.order_id, 'started', m);
    return this.readTask(c, id);
  }
  /**
   * Фиксирует положительную фактическую часть либо нулевое сообщение о нехватке.
   * Количество — приращение, не накопительный итог. Предел remaining проверяется под parent locks.
   * Любая ошибка inventory/audit/outbox выходит до runner; найденное и состояние не коммитятся отдельно.
   */
  async confirmPickedQuantity(
    c: TransactionContext,
    id: string,
    actorId: string,
    input: {
      taskLineId: string;
      actualQuantity: number;
      targetLocationId?: string;
      shortage: boolean;
    },
    m: OperationMetadata,
  ) {
    const { task } = await this.findTaskWarehouse(c, id);
    const order = await this.orders.get(c, task.order_id, true);
    const locked = await this.repository.findTask(c, id, true);
    if (order?.status !== 'active' || locked?.status !== 'in_progress')
      throw new CommandError('ORDER_STATE_CONFLICT');
    if (locked.assignee_id !== actorId) throw new CommandError('FORBIDDEN');
    const line = (await this.repository.listLines(c, id)).find((l) => l.id === input.taskLineId);
    if (
      !line ||
      !Number.isInteger(input.actualQuantity) ||
      input.actualQuantity < 0 ||
      input.actualQuantity > line.planned - line.picked_total - line.cancelled_unpicked ||
      (!input.actualQuantity && !input.shortage)
    )
      throw new CommandError('VALIDATION_FAILED');
    if (input.actualQuantity > 0) {
      if (!input.targetLocationId) throw new CommandError('VALIDATION_FAILED');
      await this.inventory.pickReservedQuantity(
        c,
        line.allocation_id,
        input.targetLocationId,
        input.actualQuantity,
        line.id,
        m,
      );
      await this.repository.addPickedQuantity(c, line.id, input.actualQuantity);
    }
    const remaining = (await this.repository.listLines(c, id)).reduce(
      (n, l) => n + l.planned - l.picked_total - l.cancelled_unpicked,
      0,
    );
    if (input.shortage && !remaining) throw new CommandError('VALIDATION_FAILED');
    await this.repository.setTaskState(
      c,
      id,
      !remaining ? 'completed' : input.shortage ? 'shortage' : 'in_progress',
      actorId,
    );
    await this.recordProgress(
      c,
      id,
      task.order_id,
      input.shortage ? 'shortage' : !remaining ? 'completed' : 'picked',
      m,
    );
    return this.readTask(c, id);
  }
  /** Release планируемого резерва не должен молча обесценить план. Явная отмена заказа обрабатывается отдельно. */
  async assertNoOpenTaskBeforeRelease(c: TransactionContext, orderId: string) {
    if (await this.repository.hasOpenTask(c, orderId))
      throw new CommandError('ORDER_STATE_CONFLICT');
  }
  /** Отмена до переноса закрывает план и пишет факты в той же транзакции release заказа. */
  async cancelUnpickedTasks(c: TransactionContext, orderId: string, m: OperationMetadata) {
    for (const t of await this.repository.cancelUnpickedTasks(c, orderId))
      await this.recordProgress(c, t.id, orderId, 'cancelled', m);
  }
  /** Audit и retained outbox fact используют тот же context; подписчиков нового агрегата пока нет. */
  private async recordProgress(
    c: TransactionContext,
    id: string,
    orderId: string,
    action: 'created' | 'started' | 'picked' | 'shortage' | 'completed' | 'cancelled',
    m: OperationMetadata,
  ) {
    await this.audit.write(c, {
      ...m,
      entityType: 'picking-task',
      entityId: id,
      action: `fulfillment.picking-${action}`,
    });
    await this.outbox.append(c, {
      type: 'fulfillment.picking-progressed',
      schemaVersion: 1,
      aggregateType: 'picking-task',
      aggregateId: id,
      occurredAt: new Date().toISOString(),
      correlationId: m.correlationId,
      payload: { taskId: id, orderId, action },
    });
  }
}
