/** @file Схема задания размещения: одна задача на строку приёмки с проверяемым происхождением.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { receipts, receiptLines } from '../receiving/receiving.schema';
import { auditEntries } from '../audit/audit.schema';
import { MAX_STOCK_QUANTITY } from '../../shared/quantities/quantity';
/**
 * Снимок основания размещения, не резерв и не движение; target location появится при выполнении
 * размещения.
 */
export const putawayTasks = pgTable(
  'putaway_tasks',
  {
    /**
     * UUID задания назначается сервисом до INSERT. Это новое задание планирования, а не идентификатор
     * движения и не признак физического размещения.
     */
    id: uuid('id').primaryKey(),
    /**
     * UUID исходной приёмки входит в составные FK происхождения: task должен относиться к конкретному
     * проведённому документу.
     */
    sourceReceiptId: uuid('source_receipt_id').notNull(),

    /**
     * UUID строки с UNIQUE: даже другой event не может создать второе задание для той же строки при
     * текущих правилах.
     */
    sourceReceiptLineId: uuid('source_receipt_line_id').notNull().unique(),
    /**
     * UUID события-основания. Составной FK сверяет его с postedEventId документа; UNIQUE(event,line)
     * дополнительно защищает повтор доставки.
     */
    sourceEventId: uuid('source_event_id').notNull(),

    /**
     * UUID склада зафиксирован вместе с sourceReceiptId/sourceEventId; дублирование осознанно, чтобы
     * составной FK проверял согласованность источника.
     */
    warehouseId: uuid('warehouse_id').notNull(),
    /**
     * UUID исходной receiving-ячейки, не целевой storage-ячейки. Проверяется вместе со складом и
     * документом; адрес назначения ещё не реализован.
     */
    sourceLocationId: uuid('source_location_id').notNull(),

    /**
     * UUID товара снимка основания. Составной FK на строку проверяет соответствие product и quantity
     * источнику, а не только существование товара.
     */
    productId: uuid('product_id').notNull(),
    /**
     * Количество задания int4 в штуках, CHECK 1..MAX. Совпадает с исходной строкой по составному FK;
     * создание task само по себе не меняет stock.
     */
    quantity: integer('quantity').notNull(),

    /**
     * text с единственным pending по CHECK. Означает ожидание физического размещения; доставка outbox
     * при этом уже может быть completed.
     */
    status: text('status').$type<'pending'>().default('pending').notNull(),

    /**
     * UUID/FK объясняющего аудита. Task, audit, marker и cursors подтверждаются одной транзакцией
     * worker, а не отдельными commit.
     */
    auditId: uuid('audit_id')
      .notNull()
      .references(() => auditEntries.id),

    /**
     * timestamptz создания задания в БД, defaultNow от начала processing-транзакции; не равно
     * бизнес-времени postedAt исходной приёмки.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // UNIQUE строки запрещает вторую task вообще; UNIQUE(event,line) дополнительно выражает
    // идемпотентность повторной доставки того же события. Это не повторное начисление остатков.
    unique('putaway_event_line_unique').on(t.sourceEventId, t.sourceReceiptLineId),
    // Composite FK проверяют business provenance без чтения чужих repositories:
    // документ posted именно этим event, line/product/quantity действительно принадлежат ему.
    foreignKey({
      name: 'putaway_receipt_source_fk',
      columns: [t.sourceReceiptId, t.warehouseId, t.sourceLocationId, t.sourceEventId],
      foreignColumns: [
        receipts.id,
        receipts.warehouseId,
        receipts.receivingLocationId,
        receipts.postedEventId,
      ],
    }),
    foreignKey({
      name: 'putaway_receipt_line_fk',
      columns: [t.sourceReceiptId, t.sourceReceiptLineId, t.productId, t.quantity],
      foreignColumns: [
        receiptLines.receiptId,
        receiptLines.id,
        receiptLines.productId,
        receiptLines.quantity,
      ],
    }),
    check('putaway_pending_status', sql`${t.status} = 'pending'`),
    check(
      'putaway_quantity_range',
      sql`${t.quantity} between 1 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`,
    ),
  ],
);
