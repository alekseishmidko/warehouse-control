/** @file Shipment и компенсационная отмена: один order lock/context для stock, allocation, audit, event и HTTP result. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrdersRepository } from '../repositories/orders.repository';
import { ShipmentsRepository } from '../repositories/shipments.repository';
import { PickingService } from './picking.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { AuditService } from '../../audit/services/audit.service';
import { OutboxService } from '../../../infrastructure/outbox/services/outbox.service';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { CommandError } from '../../../shared/errors/command-error';
/** Private fulfillment service. Состояния документа проверяются после order lock, без внешнего I/O. */
@Injectable()
export class ShippingService {
  /** Все зависимости — собственные repositories или публичные сервисы владельцев. */
  constructor(
    private readonly repository: ShipmentsRepository,
    private readonly orders: OrdersRepository,
    private readonly picking: PickingService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}
  /** Метаданные до ACL: результат не отправляется клиенту без проверки фактического склада. */
  async findShipmentWarehouse(c: TransactionContext, id: string) {
    const shipment = await this.repository.findShipment(c, id);
    if (!shipment) throw new CommandError('SHIPMENT_NOT_FOUND');
    const order = await this.orders.get(c, shipment.order_id);
    if (!order) throw new CommandError('ORDER_NOT_FOUND');
    return { shipment, warehouseId: order.warehouse_id };
  }
  /** GET удерживает order SHARE для согласованного чтения header/lines. Команда уже имеет UPDATE. */
  async readShipment(c: TransactionContext, id: string, lock = false) {
    let { shipment, warehouseId } = await this.findShipmentWarehouse(c, id);
    if (lock) {
      await this.orders.get(c, shipment.order_id, 'share');
      shipment = (await this.repository.findShipment(c, id))!;
    }
    return {
      id: shipment.id,
      orderId: shipment.order_id,
      warehouseId,
      status: shipment.status,
      reasonCode: shipment.reason_code,
      postedAt: shipment.posted_at === null ? null : new Date(shipment.posted_at).toISOString(),
      lines: (await this.repository.listLines(c, id)).map((l) => ({
        id: l.id,
        allocationId: l.allocation_id,
        quantity: l.quantity,
      })),
    };
  }
  /** Полный снимок allocations одного заказа, без SQL чужого модуля; порядок SKU стабилен. */
  private async listOrderAllocations(c: TransactionContext, orderId: string) {
    const result = [];
    for (const line of await this.orders.lines(c, orderId))
      result.push({ line, allocations: await this.inventory.allocations(c, line.id) });
    return result;
  }
  /** Создаёт draft выбранной staged партии; несколько draft не создают дополнительного резерва. */
  async prepareShipment(
    c: TransactionContext,
    orderId: string,
    input: { reasonCode: string; lines: { allocationId: string; quantity: number }[] },
    m: OperationMetadata,
  ) {
    const order = await this.orders.get(c, orderId, true);
    if (!order) throw new CommandError('ORDER_NOT_FOUND');
    if (order.status !== 'active') throw new CommandError('ORDER_STATE_CONFLICT');
    const allocations = (await this.listOrderAllocations(c, orderId)).flatMap((l) => l.allocations);
    for (const l of input.lines) {
      const a = allocations.find((a) => a.id === l.allocationId);
      if (!a || a.locationKind !== 'shipping' || a.active < l.quantity)
        throw new CommandError('VALIDATION_FAILED');
    }
    const id = randomUUID();
    await this.repository.createDraft(
      c,
      id,
      orderId,
      input.reasonCode,
      input.lines.map((l) => ({ ...l, id: randomUUID() })),
    );
    await this.recordChange(
      c,
      orderId,
      'shipment-prepared',
      { ...m, reasonCode: input.reasonCode },
      id,
    );
    return this.readShipment(c, id);
  }
  /** Перепроверяет staged stock на posting, не доверяя снимку draft. Все строки фиксируются полностью либо rollback. */
  async postShipment(c: TransactionContext, id: string, m: OperationMetadata) {
    const { shipment } = await this.findShipmentWarehouse(c, id);
    const order = await this.orders.get(c, shipment.order_id, true);
    const current = await this.repository.findShipment(c, id, true);
    if (order?.status !== 'active' || current?.status !== 'draft')
      throw new CommandError('ORDER_STATE_CONFLICT');
    const lines = await this.repository.listLines(c, id);
    await this.inventory.applyShippingEffects(
      c,
      order.id,
      'ship',
      lines.map((l) => ({
        allocationId: l.allocation_id,
        quantity: l.quantity,
        shipmentLineId: l.id,
      })),
      { ...m, reasonCode: current.reason_code },
    );
    await this.repository.setStatus(c, id, 'posted');
    const snapshot = await this.listOrderAllocations(c, order.id);
    if (
      snapshot.every((l) => l.allocations.reduce((n, a) => n + a.consumed, 0) === l.line.quantity)
    )
      await this.orders.state(c, order.id, 'completed');
    await this.recordChange(
      c,
      order.id,
      'shipment-posted',
      { ...m, reasonCode: current.reason_code },
      id,
    );
    return this.readShipment(c, id);
  }
  /** Отмена draft не меняет stock/reservation; reason — проверенный операторский код. */
  async cancelShipmentDraft(
    c: TransactionContext,
    id: string,
    reasonCode: string,
    m: OperationMetadata,
  ) {
    const { shipment } = await this.findShipmentWarehouse(c, id);
    await this.orders.get(c, shipment.order_id, true);
    const current = await this.repository.findShipment(c, id, true);
    if (current?.status !== 'draft') throw new CommandError('ORDER_STATE_CONFLICT');
    await this.repository.setStatus(c, id, 'cancelled');
    await this.recordChange(c, shipment.order_id, 'shipment-cancelled', { ...m, reasonCode }, id);
    return this.readShipment(c, id);
  }
  /** Запрос B3: staged stock сохраняется в cancel_pending, без фиктивного физического возврата. */
  async requestOrderCancellation(c: TransactionContext, orderId: string, m: OperationMetadata) {
    const order = await this.orders.get(c, orderId, true);
    if (!order || !['draft', 'active'].includes(order.status))
      throw new CommandError('ORDER_STATE_CONFLICT');
    const snapshot = await this.listOrderAllocations(c, orderId);
    if (
      snapshot.some((l) => l.allocations.some((a) => a.locationKind === 'shipping' && a.active > 0))
    ) {
      await this.orders.state(c, orderId, 'cancel_pending');
      await this.recordChange(c, orderId, 'cancellation-requested', m);
      return;
    }
    await this.releaseStorageAndCloseOrder(c, orderId, m);
    await this.recordChange(c, orderId, 'cancellation-completed', m);
  }
  /**
   * Фиксирует физический возврат всего staged остатка. DTO агрегирован по order line,
   * поэтому один товар из множества shipping allocations не раздувает HTTP-вектор без границ.
   * Каждая строка должна точно покрывать active shipping; частичная компенсация B3 не добавляется.
   */
  async completeCancellationReturn(
    c: TransactionContext,
    orderId: string,
    input: {
      reasonCode: string;
      lines: { lineId: string; quantity: number; targetLocationId: string }[];
    },
    m: OperationMetadata,
  ) {
    const order = await this.orders.get(c, orderId, true);
    if (order?.status !== 'cancel_pending') throw new CommandError('ORDER_STATE_CONFLICT');
    const snapshot = await this.listOrderAllocations(c, orderId);
    const staged = snapshot.filter((l) =>
      l.allocations.some((a) => a.locationKind === 'shipping' && a.active > 0),
    );
    if (!staged.length || input.lines.length !== staged.length)
      throw new CommandError('VALIDATION_FAILED');
    const effects = [];
    for (const l of staged) {
      const declared = input.lines.find((i) => i.lineId === l.line.id);
      const allocations = l.allocations.filter(
        (a) => a.locationKind === 'shipping' && a.active > 0,
      );
      const quantity = allocations.reduce((n, a) => n + a.active, 0);
      if (!declared || declared.quantity !== quantity) throw new CommandError('VALIDATION_FAILED');
      for (const a of allocations)
        effects.push({
          allocationId: a.id,
          quantity: a.active,
          targetLocationId: declared.targetLocationId,
        });
    }
    await this.inventory.applyShippingEffects(c, orderId, 'return', effects, {
      ...m,
      reasonCode: input.reasonCode,
    });
    await this.releaseStorageAndCloseOrder(c, orderId, { ...m, reasonCode: input.reasonCode });
    await this.recordChange(c, orderId, 'cancellation-completed', {
      ...m,
      reasonCode: input.reasonCode,
    });
  }
  /** Выпускает storage и закрывает только неотгруженную часть, сохраняя picked/consumed историю. */
  private async releaseStorageAndCloseOrder(
    c: TransactionContext,
    orderId: string,
    m: OperationMetadata,
  ) {
    const snapshot = await this.listOrderAllocations(c, orderId);
    await this.picking.cancelUnpickedTasks(c, orderId, m);
    for (const l of snapshot)
      for (const a of l.allocations)
        if (a.active) {
          if (a.locationKind !== 'storage') throw new CommandError('ORDER_STATE_CONFLICT');
          await this.inventory.release(c, l.line.id, a.id, a.active);
          await this.audit.write(c, {
            ...m,
            entityType: 'allocation',
            entityId: a.id,
            action: 'inventory.allocation-released',
            changes: { quantity: { after: a.active } },
          });
        }
    await this.orders.state(
      c,
      orderId,
      snapshot.some((l) => l.allocations.some((a) => a.consumed > 0))
        ? 'closed_mixed'
        : 'cancelled',
    );
  }
  /** Новый event type, а не расширение enum опубликованного OrderChanged v1. */
  private async recordChange(
    c: TransactionContext,
    orderId: string,
    action:
      | 'shipment-prepared'
      | 'shipment-posted'
      | 'shipment-cancelled'
      | 'cancellation-requested'
      | 'cancellation-completed',
    m: OperationMetadata,
    shipmentId?: string,
  ) {
    await this.audit.write(c, {
      ...m,
      entityType: shipmentId ? 'shipment' : 'order',
      entityId: shipmentId ?? orderId,
      action: `fulfillment.${action}`,
    });
    await this.outbox.append(c, {
      type: 'fulfillment.shipping-changed',
      schemaVersion: 1,
      aggregateType: 'order',
      aggregateId: orderId,
      occurredAt: new Date().toISOString(),
      correlationId: m.correlationId,
      payload: { orderId, action, ...(shipmentId ? { shipmentId } : {}) },
    });
  }
}
