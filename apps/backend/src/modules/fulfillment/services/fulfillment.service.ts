/** @file Сценарии заказа ADR-0022: один borrowed context для order, inventory, audit и outbox, без внешнего I/O. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrdersRepository } from '../repositories/orders.repository';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CatalogService } from '../../catalog/services/catalog.service';
import { AuditService } from '../../audit/services/audit.service';
import { OutboxService } from '../../../infrastructure/outbox/services/outbox.service';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { isUuid } from '../../../shared/validation/identifiers';
import { CommandError } from '../../../shared/errors/command-error';
import { CreateOrderDto } from '../dto/create-order.dto';
import { ReserveOrderDto } from '../dto/reserve-order.dto';
/** Экспортируемый владелец заказа, repository private; stock изменяет только InventoryService. */
@Injectable()
export class FulfillmentService {
  /** DI без циклической зависимости inventory → fulfillment service. */
  constructor(
    private readonly repository: OrdersRepository,
    private readonly inventory: InventoryService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}
  /** Warehouse immutable: metadata read до user/session policy, без order lock и без чтения чужого SQL. */
  async warehouse(c: TransactionContext, id: string) {
    const o = await this.repository.get(c, id);
    if (!o) throw new CommandError('ORDER_NOT_FOUND');
    return o.warehouse_id;
  }
  /** Чтение снимка с открытым количеством и историей allocations; lock используется до mutations. */
  async read(c: TransactionContext, id: string, lock: false | true | 'share' = false) {
    const order = await this.repository.get(c, id, lock);
    if (!order) throw new CommandError('ORDER_NOT_FOUND');
    const lines = [];
    for (const line of await this.repository.lines(c, id)) {
      const allocations = await this.inventory.allocations(c, line.id);
      const active = allocations.reduce((n, a) => n + a.active, 0);
      lines.push({
        id: line.id,
        productId: line.product_id,
        quantity: line.quantity,
        open: order.status === 'cancelled' ? 0 : line.quantity - active,
        reservedStorage: active,
        reservedShipping: 0,
        shipped: 0,
        cancelled: order.status === 'cancelled' ? line.quantity : 0,
        allocations,
      });
    }
    return { id: order.id, warehouseId: order.warehouse_id, status: order.status, lines };
  }
  /** Нормализация до fingerprint; дубли и неверные внутренние quantities отклоняются до SQL. */
  normalize(input: CreateOrderDto) {
    if (
      !input ||
      !isUuid(input.warehouseId) ||
      !Array.isArray(input.lines) ||
      input.lines.some((l) => !l || !isUuid(l.productId))
    )
      throw new CommandError('VALIDATION_FAILED');
    const lines = input.lines
      .map((l) => ({ productId: l.productId.toLowerCase(), quantity: l.quantity }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    if (
      !lines.length ||
      lines.length > 1000 ||
      new Set(lines.map((l) => l.productId)).size !== lines.length ||
      lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 2147483647)
    )
      throw new CommandError('VALIDATION_FAILED');
    return { warehouseId: input.warehouseId.toLowerCase(), lines };
  }
  /** Draft с immutable составом; наличие SKU проверяет catalog, warehouse — FK/ACL. */
  async create(c: TransactionContext, input: CreateOrderDto, m: OperationMetadata) {
    const value = this.normalize(input);
    for (const l of value.lines) await this.catalog.requireProduct(c, l.productId);
    const id = randomUUID();
    await this.repository.create(
      c,
      id,
      value.warehouseId,
      value.lines.map((l) => ({ ...l, id: randomUUID() })),
    );
    await this.record(c, id, 'created', m);
    return this.read(c, id);
  }
  /** Любая mutation сначала блокирует родителя: reserve/release/cancel одного заказа сериализуются. */
  async change(
    c: TransactionContext,
    id: string,
    action: 'confirm' | 'reserve' | 'release' | 'cancel',
    input: ReserveOrderDto | { quantity: number } | undefined,
    m: OperationMetadata,
    allocationId?: string,
  ) {
    const order = await this.read(c, id, true);
    if (action === 'confirm') {
      if (order.status !== 'draft') throw new CommandError('ORDER_STATE_CONFLICT');
      await this.repository.state(c, id, 'active');
    } else if (action === 'cancel') {
      if (!['draft', 'active'].includes(order.status))
        throw new CommandError('ORDER_STATE_CONFLICT');
      // SKU/location порядок совпадает с reserve; release history не удаляется, onHand не меняется.
      for (const l of order.lines)
        for (const a of l.allocations)
          if (a.active) {
            await this.inventory.release(c, l.id, a.id, a.active);
            await this.audit.write(c, {
              ...m,
              entityType: 'allocation',
              entityId: a.id,
              action: 'inventory.allocation-released',
              changes: { quantity: { after: a.active } },
            });
          }
      await this.repository.state(c, id, 'cancelled');
    } else {
      if (order.status !== 'active') throw new CommandError('ORDER_STATE_CONFLICT');
      if (action === 'reserve') {
        const requested = (input as ReserveOrderDto).lines;
        if (
          !requested.length ||
          requested.length > 1000 ||
          new Set(requested.map((l) => l.lineId.toLowerCase())).size !== requested.length
        )
          throw new CommandError('VALIDATION_FAILED');
        const quantities = new Map(requested.map((l) => [l.lineId.toLowerCase(), l.quantity]));
        if (
          requested.some(
            (l) =>
              !order.lines.some((o) => o.id === l.lineId.toLowerCase()) ||
              !Number.isInteger(l.quantity) ||
              l.quantity < 1,
          )
        )
          throw new CommandError('VALIDATION_FAILED');
        for (const l of order.lines) {
          const q = quantities.get(l.id);
          if (q === undefined) continue;
          if (q > l.open) throw new CommandError('ORDER_STATE_CONFLICT');
          await this.inventory.reserve(c, order.warehouseId, l.id, l.productId, q);
          // Каждый новый allocation имеет отдельный immutable audit с точным количеством.
          for (const a of await this.inventory.allocations(c, l.id))
            if (!l.allocations.some((old) => old.id === a.id))
              await this.audit.write(c, {
                ...m,
                entityType: 'allocation',
                entityId: a.id,
                action: 'inventory.allocation-created',
                changes: { quantity: { after: a.allocated } },
              });
        }
      } else {
        const line = order.lines.find((l) => l.allocations.some((a) => a.id === allocationId));
        if (!line) throw new CommandError('ALLOCATION_NOT_FOUND');
        const q = (input as { quantity: number }).quantity;
        if (!Number.isInteger(q) || q < 1) throw new CommandError('VALIDATION_FAILED');
        await this.inventory.release(c, line.id, allocationId!, q);
        await this.audit.write(c, {
          ...m,
          entityType: 'allocation',
          entityId: allocationId!,
          action: 'inventory.allocation-released',
          changes: { quantity: { after: q } },
        });
      }
    }
    await this.record(
      c,
      id,
      action === 'confirm'
        ? 'confirmed'
        : action === 'reserve'
          ? 'reserved'
          : action === 'release'
            ? 'released'
            : 'cancelled',
      m,
    );
    return this.read(c, id);
  }
  /** Audit и факт в том же context; событие ссылается на заказ, полный состав не дублируется в envelope. */
  private async record(
    c: TransactionContext,
    id: string,
    action: 'created' | 'confirmed' | 'reserved' | 'released' | 'cancelled',
    m: OperationMetadata,
  ) {
    await this.audit.write(c, {
      ...m,
      entityType: 'order',
      entityId: id,
      action: `fulfillment.order-${action}`,
    });
    await this.outbox.append(c, {
      type: 'fulfillment.order-changed',
      schemaVersion: 1,
      aggregateType: 'order',
      aggregateId: id,
      occurredAt: new Date().toISOString(),
      correlationId: m.correlationId,
      payload: { orderId: id, action },
    });
  }
}
