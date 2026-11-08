/** @file Неизменяемые основания shipment/физического возврата. Сохраняются отдельно от picking transfers.
 * UUID — JS/JSON string, quantity int4 — точное число штук. Все FK без cascade.
 * Полноту движений и итог consumed/released сверяют deferred guards, а не TypeScript. */
import { pgTable, uuid, text, integer, check, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { allocations } from './allocations.schema';
import { stockBalances } from '../inventory.schema';
import { shipments, shipmentLines } from '../../fulfillment/schemas/shipments.schema';
import { orders } from '../../fulfillment/schemas/orders.schema';
import { auditEntries } from '../../audit/audit.schema';
/** Ship создаёт одно движение расхода, return — пару shipping → storage и освобождает резерв. */
export const shippingEffects = pgTable(
  'shipping_effects',
  {
    /** UUID сервера, PK без NULL/default. */ id: uuid('id').primaryKey(),
    /** Обязательный text ship/return без default: выбирает ровно один протокол движений. */ kind: text(
      'kind',
    ).notNull(),
    /** Обязательный UUID/FK исходного shipping allocation. */ allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id),
    /** Обязательный UUID/FK заказа; deferred guard сверяет с allocation. */ orderId: uuid(
      'order_id',
    )
      .notNull()
      .references(() => orders.id),
    /** Nullable UUID/FK строки shipment; UNIQUE предотвращает повторное списание. NULL только для return. */ shipmentLineId:
      uuid('shipment_line_id')
        .references(() => shipmentLines.id)
        .unique(),
    /** Nullable UUID/FK target balance: storage для return, NULL для ship. */ targetBalanceId:
      uuid('target_balance_id').references(() => stockBalances.id),
    /** Обязательные положительные int4 штуки без default. */ quantity:
      integer('quantity').notNull(),
    /** Обязательный UUID/FK immutable audit, общий с движением/парой. */ auditId: uuid('audit_id')
      .notNull()
      .references(() => auditEntries.id),
  },
  (t) => [
    // Положительный ship требует строку shipment без target; return требует target без shipment line.
    // Проверка формы не заменяет проверку заказа, зоны и полного вектора возврата.
    check(
      'shipping_effect_shape',
      sql`${t.quantity}>0 and ((${t.kind}='ship' and ${t.shipmentLineId} is not null and ${t.targetBalanceId} is null) or (${t.kind}='return' and ${t.shipmentLineId} is null and ${t.targetBalanceId} is not null))`,
    ),
  ],
);
