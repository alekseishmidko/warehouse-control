/** @file Схемы worker: маркеры идемпотентного эффекта и курсоры логических потребителей.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { outboxEvents, outboxAggregateSequences } from '../outbox/outbox.schema';
import { foreignKey } from 'drizzle-orm/pg-core';
import { MAX_AGGREGATE_VERSION } from '../outbox/outbox-destinations';
/** Уникальный факт применения event данным logical consumer, не ack Kafka. */
export const processedEvents = pgTable(
  'processed_events',
  {
    /**
     * Стабильное text-имя логического обработчика, не процесса/реплики. CHECK ограничивает slug; смена
     * имени создаст другую область дедупликации.
     */
    consumerName: text('consumer_name').notNull(),
    /**
     * UUID/FK сохранённого факта, общий для всех повторных доставок. PK(consumerName,eventId)
     * запрещает второй marker у того же consumer.
     */
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.eventId),

    /**
     * timestamptz отметки обработки, defaultNow от начала транзакции. Marker подтверждается атомарно с
     * эффектом; сама дата не доказывает отдельный Kafka ack.
     */
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Составной PK — долговечная область дедупликации. Смена consumerName обходит старые
    // markers, поэтому требует плана миграции/обработки истории, а не переименования настройки.
    primaryKey({ columns: [t.consumerName, t.eventId] }),
    check('processed_consumer_name', sql`${t.consumerName} ~ '^[a-z][a-z0-9.-]{0,95}$'`),
  ],
);
/** Отдельный consumer cursor сохраняется при будущем переносе транспорта с outbox на Kafka. */
export const consumerStreams = pgTable(
  'consumer_streams',
  {
    /**
     * text-имя логического потребителя входит в PK потока; разные consumers вправе иметь разные
     * курсоры одного агрегата.
     */
    consumerName: text('consumer_name').notNull(),
    /**
     * text-пространство идентичности агрегата. Составной FK к sequence связывает его с aggregateId;
     * один UUID без типа недостаточен.
     */
    aggregateType: text('aggregate_type').notNull(),
    /**
     * UUID агрегата, а не события. Определяет локальный порядок только внутри consumer/type/id,
     * глобального порядка между агрегатами нет.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    /**
     * bigint с mode:number и CHECK 0..Number.MAX_SAFE_INTEGER: SQL диапазон шире точного JS number.
     * Ноль — не обработано ничего, версия события начинается с 1.
     */
    lastProcessedVersion: bigint('last_processed_version', { mode: 'number' }).default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.consumerName, t.aggregateType, t.aggregateId] }),
    foreignKey({
      columns: [t.aggregateType, t.aggregateId],
      foreignColumns: [
        outboxAggregateSequences.aggregateType,
        outboxAggregateSequences.aggregateId,
      ],
    }),
    check('consumer_name', sql`${t.consumerName} ~ '^[a-z][a-z0-9.-]{0,95}$'`),
    check(
      'consumer_cursor_range',
      sql`${t.lastProcessedVersion} between 0 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`,
    ),
  ],
);
