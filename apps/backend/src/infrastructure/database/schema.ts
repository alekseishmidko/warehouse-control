/** @file Агрегатор Drizzle-схем модулей для миграций и технические метаданные инсталляции.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
export { auditEntries } from '../../modules/audit/audit.schema';

/** Метаданные инсталляции; не источник stock или версия состояния бизнес-агрегатов. */
export const applicationMetadata = pgTable('application_metadata', {
  /**
   * Техническое имя настройки — естественный PK из text; отдельный UUID здесь не даёт полезной
   * идентичности.
   */
  key: text('key').primaryKey(),

  /**
   * Текстовое значение технических метаданных. NOT NULL запрещает отсутствие, но не пустую строку;
   * это не хранилище секретов или stock.
   */
  value: text('value').notNull(),

  /**
   * Момент вставки: timestamptz хранит абсолютное время, а не исходный часовой пояс. defaultNow —
   * начало транзакции, не время commit.
   */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export { products } from '../../modules/catalog/catalog.schema';
export { warehouses, locations } from '../../modules/warehouses/warehouses.schema';
export { stockBalances, stockMovements } from '../../modules/inventory/inventory.schema';
export {
  outboxAggregateSequences,
  outboxEvents,
  outboxDeliveries,
  deliveryStreams,
  outboxRecoveryActions,
} from '../outbox/outbox.schema';
export { httpIdempotency } from '../idempotency/idempotency.schema';
export { receipts, receiptLines } from '../../modules/receiving/receiving.schema';
export { processedEvents, consumerStreams } from '../worker/worker.schema';
export { putawayTasks } from '../../modules/inventory/putaway-task.schema';

export { users } from '../../modules/identity/schemas/users.schema';
export { sessions } from '../../modules/identity/schemas/sessions.schema';
export { warehouseRoles } from '../../modules/identity/schemas/warehouse-roles.schema';
export { loginWindows } from '../../modules/identity/schemas/login-windows.schema';
export { identityBootstrap } from '../../modules/identity/schemas/identity-bootstrap.schema';

export { orders, orderLines } from '../../modules/fulfillment/schemas/orders.schema';
export { allocations } from '../../modules/inventory/schemas/allocations.schema';
