/** @file Схемы документа приёмки и строк: целые количества, состояния draft/posted и источник событий.
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
import { products } from '../catalog/catalog.schema';
import { locations } from '../warehouses/warehouses.schema';
import { outboxEvents } from '../../infrastructure/outbox/outbox.schema';
import { MAX_RECEIPT_LINES } from '../../shared/events/event-registry';
import { MAX_STOCK_QUANTITY } from '../../shared/quantities/quantity';
/** Один draft либо полностью проведённый документ; immutable guards находятся в custom migration. */
export const receipts = pgTable(
  'receipts',
  {
    /**
     * UUID документа назначает сценарий до INSERT; отсутствие DB default позволяет использовать ту же
     * идентичность при формировании связанных данных.
     */
    id: uuid('id').primaryKey(),
    /**
     * UUID склада приёмки. Принадлежность receivingLocationId защищена составным FK, а не двумя
     * независимыми ссылками.
     */
    warehouseId: uuid('warehouse_id').notNull(),
    /**
     * UUID ячейки начисления. FK проверяет склад/ячейку, сервис дополнительно требует kind=receiving;
     * этого CHECK состояния документа не проверяет.
     */
    receivingLocationId: uuid('receiving_location_id').notNull(),

    /**
     * text draft/posted, TypeScript union для кода. Реальное ограничение — receipt_state: статус
     * связан с nullability postedAt/postedEventId, частично проведённое состояние запрещено.
     */
    status: text('status').$type<'draft' | 'posted'>().default('draft').notNull(),

    /**
     * timestamptz создания draft, defaultNow — начало транзакции создания. Это не время проведения и
     * не время получения HTTP-ответа.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    /**
     * Nullable timestamptz: null означает draft, а не неизвестную дату. Сценарий назначает то же
     * время, что occurredAt события; CHECK требует значение для posted.
     */
    postedAt: timestamp('posted_at', { withTimezone: true }),
    /**
     * Nullable UUID/FK на сохранённое outbox-событие, UNIQUE связывает событие максимум с одним
     * документом. Несколько SQL NULL для draft допустимы; payload/тип события проверяет сценарий.
     */
    postedEventId: uuid('posted_event_id')
      .references(() => outboxEvents.eventId)
      .unique(),
  },
  (t) => [
    // Расширенный UNIQUE нужен как цель составного FK task: документ, склад, ячейка и event
    // должны принадлежать одному источнику. Иммутабельность posted обеспечивают отдельные триггеры.
    unique('receipt_putaway_source_unique').on(
      t.id,
      t.warehouseId,
      t.receivingLocationId,
      t.postedEventId,
    ),
    foreignKey({
      name: 'receipt_location_warehouse_fk',
      columns: [t.warehouseId, t.receivingLocationId],
      foreignColumns: [locations.warehouseId, locations.id],
    }),
    check(
      'receipt_state',
      sql`(${t.status} = 'draft' and ${t.postedAt} is null and ${t.postedEventId} is null) or (${t.status} = 'posted' and ${t.postedAt} is not null and ${t.postedEventId} is not null)`,
    ),
  ],
);
/** Неизменяемые строки; unique position + диапазон ограничивают размер даже при прямом INSERT. */
export const receiptLines = pgTable(
  'receipt_lines',
  {
    /**
     * UUID строки назначает сценарий; он же operationId единственного движения при проведении.
     * Отдельная идентичность сохраняется при передаче в событие и task.
     */
    id: uuid('id').primaryKey(),
    /**
     * Обязательный UUID/FK на документ-владелец. Автоматическое каскадное удаление не задано: история
     * не должна исчезать вместе с документом.
     */
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id),

    /**
     * Порядок строки в документе: int4 1..MAX_RECEIPT_LINES и UNIQUE(receiptId,position). Вместе они
     * ограничивают число строк; UUID для сортировки не подходит.
     */
    position: integer('position').notNull(),
    /**
     * UUID/FK товара. UNIQUE(receiptId,productId) запрещает повтор SKU внутри одного документа; это
     * бизнес-правило, а не глобальная уникальность товара.
     */
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /**
     * Положительное целое int4, 1..2147483647: тот же диапазон, что inventory и event schema. Для
     * дробного количества потребовалось бы согласовать SQL, JSON и сервисы.
     */
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    // Расширенный ключ позволяет task ссылаться на те же product/quantity исходной строки.
    // UNIQUE позиции + диапазон 1..MAX ограничивают число строк, но не требуют отсутствия пропусков.
    unique('receipt_line_putaway_source_unique').on(t.receiptId, t.id, t.productId, t.quantity),
    unique('receipt_line_position_unique').on(t.receiptId, t.position),
    unique('receipt_line_product_unique').on(t.receiptId, t.productId),
    check(
      'receipt_line_position',
      sql`${t.position} between 1 and ${sql.raw(String(MAX_RECEIPT_LINES))}`,
    ),
    check(
      'receipt_line_quantity',
      sql`${t.quantity} between 1 and ${sql.raw(String(MAX_STOCK_QUANTITY))}`,
    ),
  ],
);
