/**
 * @file Задания сборки: immutable план из резерва и исполнитель, который сам принял задание.
 * UUID в JS/JSON — строка, не секрет. Количество int4 точно представимо как number/JSON integer.
 * timestamptz возвращается как Date и сериализуется UTC ISO; не хранит исходный timezone.
 * Нюансы типов: docs/database-types.md. Retention и lifecycle guards задаёт migration 0027.
 */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders } from './orders.schema';
import { users } from '../../identity/schemas/users.schema';
import { allocations } from '../../inventory/schemas/allocations.schema';
/** Один незакрытый план на заказ предотвращает двойное планирование одного резерва. */
export const pickingTasks = pgTable(
  'picking_tasks',
  {
    /** UUID сервера, PK без default/NULL; не секрет доступа. */ id: uuid('id').primaryKey(),
    /** UUID/FK заказа, без каскадного удаления; склад определяется заказом. */ orderId: uuid(
      'order_id',
    )
      .notNull()
      .references(() => orders.id),
    /** text с CHECK, default ready; несколько состояний не означают изменение резерва. */ status:
      text('status').notNull().default('ready'),
    /** Nullable UUID исполнителя: NULL до start; назначает сервер из Principal, а не клиент. */ assigneeId:
      uuid('assignee_id').references(() => users.id),
    /** timestamptz начала транзакции вставки, обязательный default now; не время commit. */ createdAt:
      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'picking_status',
      sql`${t.status} in ('ready','in_progress','shortage','completed','cancelled')`,
    ),
    check(
      'picking_assignee',
      sql`${t.status} in ('ready','cancelled') or ${t.assigneeId} is not null`,
    ),
    uniqueIndex('one_open_picking_task')
      .on(t.orderId)
      .where(sql`${t.status} in ('ready','in_progress','shortage')`),
  ],
);
/** Строка хранит историю количества; planned = picked + remaining + cancelled. */
export const pickingLines = pgTable(
  'picking_lines',
  {
    /** UUID сервера, PK без default/NULL, идентифицирует строку HTTP-команды. */ id: uuid(
      'id',
    ).primaryKey(),
    /** Обязательный UUID/FK задания; история не удаляется каскадно. */ taskId: uuid('task_id')
      .notNull()
      .references(() => pickingTasks.id),
    /** Обязательный UUID/FK исходного storage allocation. Quantity и SKU не задаются повторно клиентом. */ allocationId:
      uuid('allocation_id')
        .notNull()
        .references(() => allocations.id),
    /** int4 штуки 1..2147483647, без default; ровно активный резерв в момент создания плана. */ planned:
      integer('planned').notNull(),
    /** int4 накопленная фактическая сборка, default 0, без NULL; возврат позже её не стирает. */ pickedTotal:
      integer('picked_total').notNull().default(0),
    /** int4 отменённая несобранная часть, default 0, без NULL; не физическое движение. */ cancelledUnpicked:
      integer('cancelled_unpicked').notNull().default(0),
  },
  (t) => [
    check(
      'picking_line_quantity',
      sql`${t.planned}>0 and ${t.pickedTotal}>=0 and ${t.cancelledUnpicked}>=0 and ${t.pickedTotal}::bigint+${t.cancelledUnpicked}<=${t.planned}`,
    ),
    uniqueIndex('picking_source_once').on(t.taskId, t.allocationId),
  ],
);
