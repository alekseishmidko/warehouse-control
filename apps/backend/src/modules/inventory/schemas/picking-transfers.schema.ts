/**
 * @file Неизменяемые основания переноса резерва: одна запись связывает пару движений и две allocations.
 * Все UUID обязательны без default, в JS/JSON представлены строками. int4 — точный number в штуках.
 * FK не обеспечивают атомарность сами: запись, обе allocations и movements используют один context.
 * Нюансы типов: docs/database-types.md; deferred проверки и retention — migration 0027.
 */
import { pgTable, uuid, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { allocations } from './allocations.schema';
import { pickingLines } from '../../fulfillment/schemas/picking.schema';
import { auditEntries } from '../../audit/audit.schema';
/** История не удаляется; deferred guard проверяет пару movements перед commit. */
export const pickingTransfers = pgTable(
  'picking_transfers',
  {
    /** UUID сервера без default/NULL, PK и идентификатор пары движений. */ id: uuid(
      'id',
    ).primaryKey(),
    /** Обязательный UUID/FK строки задания, хранит основание физической операции. */ taskLineId:
      uuid('task_line_id')
        .notNull()
        .references(() => pickingLines.id),
    /** Обязательный UUID/FK allocation в хранении; его balance не переписывается. */ sourceAllocationId:
      uuid('source_allocation_id')
        .notNull()
        .references(() => allocations.id),
    /** Обязательный уникальный UUID/FK нового shipping allocation; один перенос создаёт одну запись. */ targetAllocationId:
      uuid('target_allocation_id')
        .notNull()
        .unique()
        .references(() => allocations.id),
    /** Положительные int4 штуки без default/NULL; нулевое сообщение нехватки не создаёт transfer. */ quantity:
      integer('quantity').notNull(),
    /** Обязательный UUID/FK записи аудита; движения ссылаются на тот же auditId. */ auditId: uuid(
      'audit_id',
    )
      .notNull()
      .references(() => auditEntries.id),
  },
  (t) => [check('picking_transfer_quantity', sql`${t.quantity}>0`)],
);
