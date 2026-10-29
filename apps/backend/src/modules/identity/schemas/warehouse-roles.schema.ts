/** @file Warehouse-scoped назначения: одна строка на user/warehouse/role, без неявного глобального объединения.
 * Составной PK запрещает дубли и обслуживает чтение grants по user. FK подтверждают существование
 * объектов, но не права администратора на изменение: policy/locks обеспечивает AccessService, изменение и audit — UsersService.
 * Общие нюансы SQL/JS/JSON: docs/database-types.md; flow: docs/flows/identity.md. */
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { warehouses } from '../../warehouses/warehouses.schema';
/** Grant — связь user/warehouse/role, не два независимых глобальных списка прав. */
export const warehouseRoles = pgTable(
  'warehouse_roles',
  {
    /** Обязательный UUID FK без default, строка в JS/JSON; изменение набора сериализуется блокировкой users сервисом. Каскадного удаления grants нет. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Обязательный UUID FK без default, строка в JS/JSON; существование склада проверяет FK, право на другой warehouse не даёт это назначение. */
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Обязательный text без default: CHECK ограничивает четырьмя принятыми ролями и защищает direct SQL. В отличие от PG enum изменение списка требует явной CHECK migration. Несколько разных ролей на складе разрешены. */
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.warehouseId, t.role] }),
    check(
      'identity_warehouse_role',
      sql`${t.role} in ('viewer','warehouse_operator','order_manager','warehouse_supervisor')`,
    ),
  ],
);
