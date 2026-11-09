/** @file Inventory SQL отгрузки и возврата: блокировка всех затронутых balances до первой записи. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import { CommandError } from '../../../shared/errors/command-error';
import { MAX_STOCK_QUANTITY } from '../../../shared/quantities/quantity';
/** Источник всегда читается из allocation; client не задаёт SKU/warehouse. */
export interface ShippingSource {
  id: string;
  line_id: string;
  balance_id: string;
  active: number;
  warehouse_id: string;
  product_id: string;
  location_id: string;
  kind: string;
  order_id: string;
}
/** Проверенный сервисом вектор; audit и unique effect создаются для каждого физического действия. */
export interface ShippingEffectInput {
  source: ShippingSource;
  quantity: number;
  targetLocationId?: string;
  shipmentLineId?: string;
  auditId: string;
}
/** Только внутренний provider inventory, order lock уже удерживает fulfillment. */
@Injectable()
export class ShippingStockRepository {
  /** Не блокирует источник до получения полного набора stock keys; это исключает инверсию locks. */
  async findSource(c: TransactionContext, id: string) {
    return (
      await transactionClient(c).execute<ShippingSource & Record<string, unknown>>(
        sql`select a.*,b.warehouse_id,b.product_id,b.location_id,l.kind,o.order_id from stock_allocations a join stock_balances b on b.id=a.balance_id join locations l on l.id=b.location_id join order_lines o on o.id=a.line_id where a.id=${id}`,
      )
    ).rows[0];
  }
  /**
   * Атомарно списывает или возвращает весь проверенный вектор. При overflow/нехватке исключение
   * выходит владельцу транзакции. Locks по SKU/location включают absent-key создание назначения.
   */
  async applyEffects(
    c: TransactionContext,
    kind: 'ship' | 'return',
    entries: ShippingEffectInput[],
  ) {
    const tx = transactionClient(c);
    const keys = new Map<string, { warehouse: string; product: string; location: string }>();
    for (const e of entries)
      for (const location of [
        e.source.location_id,
        ...(e.targetLocationId ? [e.targetLocationId] : []),
      ])
        keys.set(`${e.source.product_id}/${location}`, {
          warehouse: e.source.warehouse_id,
          product: e.source.product_id,
          location,
        });
    if (kind === 'return') {
      // Return и следующий release storage — один сценарий под order lock. Если взять
      // только shipping/target, поздний release A после target B инвертирует reserve A→B.
      // Собираем ВСЕ активные storage balances заказа, включая строки без staged товара.
      // order_lines читается только для retained связи allocation→order; чужих записей здесь нет.
      const storage = await tx.execute<{
        warehouse: string;
        product: string;
        location: string;
      }>(sql`select distinct b.warehouse_id as warehouse,b.product_id as product,b.location_id as location
        from stock_allocations a join stock_balances b on b.id=a.balance_id
        join locations l on l.id=b.location_id join order_lines ol on ol.id=a.line_id
        where ol.order_id=${entries[0].source.order_id} and a.active>0 and l.kind='storage'`);
      for (const key of storage.rows) keys.set(`${key.product}/${key.location}`, key);
    }
    // Единый порядок SKU/location включает поздний release отмены. Повторное получение
    // уже принадлежащего context lock при release не вводит новые ожидания после stock mutations.
    for (const [, key] of [...keys].sort(([a], [b]) => a.localeCompare(b))) {
      await tx.execute(
        sql`insert into stock_balances(warehouse_id,product_id,location_id) values(${key.warehouse},${key.product},${key.location}) on conflict(warehouse_id,location_id,product_id) do nothing`,
      );
      await tx.execute(
        sql`select id from stock_balances where warehouse_id=${key.warehouse} and product_id=${key.product} and location_id=${key.location} for update`,
      );
    }
    for (const e of entries) {
      const a = await this.findSource(c, e.source.id);
      const b = (
        await tx.execute<{ on_hand: number; reserved: number }>(
          sql`select on_hand,reserved from stock_balances where id=${a.balance_id}`,
        )
      ).rows[0];
      if (a.active < e.quantity || b.on_hand < e.quantity || b.reserved < e.quantity)
        throw new CommandError('INSUFFICIENT_STOCK');
      let targetId: string | null = null;
      if (kind === 'return') {
        const target = (
          await tx.execute<{ id: string; on_hand: number }>(
            sql`select id,on_hand from stock_balances where warehouse_id=${a.warehouse_id} and product_id=${a.product_id} and location_id=${e.targetLocationId}`,
          )
        ).rows[0];
        if (target.on_hand > MAX_STOCK_QUANTITY - e.quantity)
          throw new CommandError('STOCK_LIMIT_EXCEEDED');
        targetId = target.id;
        await tx.execute(
          sql`update stock_balances set on_hand=on_hand+${e.quantity} where id=${target.id}`,
        );
      }
      await tx.execute(
        sql`update stock_balances set on_hand=on_hand-${e.quantity},reserved=reserved-${e.quantity} where id=${a.balance_id}`,
      );
      if (kind === 'ship')
        await tx.execute(
          sql`update stock_allocations set active=active-${e.quantity},consumed=consumed+${e.quantity} where id=${a.id}`,
        );
      else
        await tx.execute(
          sql`update stock_allocations set active=active-${e.quantity},released=released+${e.quantity} where id=${a.id}`,
        );
      const effectId = randomUUID();
      await tx.execute(
        sql`insert into shipping_effects(id,kind,allocation_id,order_id,shipment_line_id,target_balance_id,quantity,audit_id) values(${effectId},${kind},${a.id},${a.order_id},${e.shipmentLineId ?? null},${targetId},${e.quantity},${e.auditId})`,
      );
      const legs =
        kind === 'ship'
          ? [['shipment', a.location_id]]
          : [
              ['transfer-out', a.location_id],
              ['transfer-in', e.targetLocationId!],
            ];
      for (const [direction, location] of legs)
        await tx.execute(
          sql`insert into stock_movements(operation_id,warehouse_id,location_id,product_id,kind,quantity,shipping_effect_id,audit_id) values(${randomUUID()},${a.warehouse_id},${location},${a.product_id},${direction},${e.quantity},${effectId},${e.auditId})`,
        );
    }
  }
}
