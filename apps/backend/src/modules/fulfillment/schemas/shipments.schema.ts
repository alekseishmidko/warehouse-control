/** @file Source Drizzle документов отгрузки: один заказ, immutable состав, draft → posted/cancelled.
 * UUID — JS/JSON string, int4 штуки — точный number; время pg Date сериализуется UTC ISO.
 * CHECK и custom guards проверяют lifecycle; наличие TypeScript типа не проверяет ввод. */
import { index, pgTable, uuid, text, integer, timestamp, check, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orders } from './orders.schema';
import { allocations } from '../../inventory/schemas/allocations.schema';
/** Несколько draft не создают дополнительного резерва; каждый posted перепроверяет покрытие. */
export const shipments = pgTable(
  'shipments',
  {
    /** UUID сервера, PK без NULL/default. */ id: uuid('id').primaryKey(),
    /** Обязательный UUID/FK заказа без default, история не удаляется каскадно. */ orderId: uuid(
      'order_id',
    )
      .notNull()
      .references(() => orders.id),
    /** text CHECK, default draft; published документ нельзя отменить или переоткрыть. */ status:
      text('status').notNull().default('draft'),
    /** Обязательный text код основания из проверенного DTO, без default; не свободный комментарий. */ reasonCode:
      text('reason_code').notNull(),
    /** Nullable timestamptz без default, заполняется только при posted; не время физического действия оператора. */ postedAt:
      timestamp('posted_at', { withTimezone: true }),
    /** Обязательный timestamptz default now — начало транзакции создания, не commit. */ createdAt:
      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Склад приходит из заказа; поддерживает orderId filter и чтение связанных документов.
    index('shipment_order_page_idx').on(t.orderId, t.createdAt, t.id),
    check(
      'shipment_state',
      sql`(${t.status} in ('draft','cancelled') and ${t.postedAt} is null) or (${t.status}='posted' and ${t.postedAt} is not null)`,
    ),
    check('shipment_reason', sql`${t.reasonCode} ~ '^[a-z][a-z0-9.-]{2,63}$'`),
  ],
);
/** Строка ссылается на конкретный shipping allocation своего заказа; исходное количество immutable. */
export const shipmentLines = pgTable(
  'shipment_lines',
  {
    /** UUID сервера, PK без NULL/default, одновременно уникальное основание списания. */ id: uuid(
      'id',
    ).primaryKey(),
    /** Обязательный UUID/FK родителя, без cascade/default. */ shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id),
    /** Обязательный UUID/FK обеспечения shipping, без default. */ allocationId: uuid(
      'allocation_id',
    )
      .notNull()
      .references(() => allocations.id),
    /** Обязательное положительное int4 в штуках, без default; верхнюю границу задаёт SQL-тип. */ quantity:
      integer('quantity').notNull(),
  },
  (t) => [
    unique('shipment_allocation_once').on(t.shipmentId, t.allocationId),
    check('shipment_line_quantity', sql`${t.quantity}>0`),
  ],
);
