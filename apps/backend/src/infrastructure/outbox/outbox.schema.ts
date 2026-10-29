/** @file Схемы outbox: транзакционные версии агрегатов, immutable события, доставки и lease потоков.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { KnownEvent } from '../../shared/events/dto/event.dto';
import { MAX_AGGREGATE_VERSION, PUTAWAY_DESTINATION } from './outbox-destinations';
import { auditEntries } from '../../modules/audit/audit.schema';

/**
 * Транзакционный счётчик вместо nextval: rollback не расходует версию; PK сериализует первый
 * INSERT агрегата.
 */
export const outboxAggregateSequences = pgTable(
  'outbox_aggregate_sequences',
  {
    /**
     * text-тип агрегата входит в PK вместе с UUID; CHECK разрешает receipt и putaway-task. Добавление нового
     * домена потребует миграции, а не только значения в коде.
     */
    aggregateType: text('aggregate_type').notNull(),

    /**
     * UUID конкретного агрегата (receipt/putaway-task). Намеренно без полиморфного FK к бизнес-таблицам:
     * принадлежность/aggregateId=receiptId либо taskId проверяет владелец публикации.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    /**
     * bigint, mode:number, CHECK 1..Number.MAX_SAFE_INTEGER. Длинный счётчик с точным JSON/JS
     * диапазоном; guarded UPDATE откатывается с транзакцией, в отличие от nextval.
     */
    lastVersion: bigint('last_version', { mode: 'number' }).notNull(),
  },
  (t) => [
    // Составной PK одновременно задаёт область счётчика и уникальный B-tree для guarded upsert.
    // Обычный SQL sequence/nextval расходовал бы значения даже при rollback бизнес-операции.
    primaryKey({ columns: [t.aggregateType, t.aggregateId] }),
    check(
      'outbox_sequence_range',
      sql`${t.lastVersion} between 1 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`,
    ),
    check('outbox_sequence_aggregate', sql`${t.aggregateType} in ('receipt','putaway-task')`),
  ],
);

/** Факт после записи не меняется; PK и unique stream version защищают от повторного eventId/sequence. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    /**
     * UUID факта назначает OutboxService до INSERT; DB default отсутствует. Повтор доставки сохраняет
     * этот ID; повторный append создаёт новый факт.
     */
    eventId: uuid('event_id').primaryKey(),

    /**
     * text-тип потока вынесен из JSONB для ключей/маршрутизации; SQL CHECK сверяет его с envelope, FK
     * — с aggregate sequence.
     */
    aggregateType: text('aggregate_type').notNull(),

    /**
     * UUID экземпляра агрегата в составе stream identity. SQL сверяет с envelope; это не универсальный
     * FK на бизнес-объект.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    /**
     * bigint для длительного потока, но mode:number безопасен только до MAX_SAFE_INTEGER, что
     * закреплено CHECK. UNIQUE(type,id,version) исключает две одинаковые версии.
     */
    aggregateVersion: bigint('aggregate_version', { mode: 'number' }).notNull(),

    /**
     * JSONB хранит проверенный снимок события с неизвестными optional fields. Не сохраняет
     * пробелы/порядок ключей/дубли ключей; $type<KnownEvent> не валидирует runtime, это делает
     * EventContracts.
     */
    envelope: jsonb('envelope').$type<KnownEvent>().notNull(),

    /**
     * timestamptz вставки outbox, defaultNow от начала транзакции. Отличается от occurredAt envelope:
     * время хранения не равно бизнес-времени и не задаёт порядок commit.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Отдельный UNIQUE нужен независимо от UUID события: два разных eventId не вправе иметь одну версию потока.
    unique('outbox_event_aggregate_version_unique').on(
      t.aggregateType,
      t.aggregateId,
      t.aggregateVersion,
    ),
    foreignKey({
      name: 'outbox_event_sequence_fk',
      columns: [t.aggregateType, t.aggregateId],
      foreignColumns: [
        outboxAggregateSequences.aggregateType,
        outboxAggregateSequences.aggregateId,
      ],
    }),
    check(
      'outbox_event_version_range',
      sql`${t.aggregateVersion} between 1 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`,
    ),
    // SQL дополняет Ajv: индексируемая identity обязана совпадать с сохранённым envelope.
    // lower для UUID сохраняет допустимость uppercase UUID на JSON-границе.
    // CHECK пропускает SQL NULL, поэтому coalesce(...,false) делает отсутствующие JSON identity отказом.
    // Это узкая проверка согласованности; полную JSON Schema и лимит bytes проверяет EventContracts.
    check(
      'outbox_envelope_identity',
      sql`coalesce(jsonb_typeof(${t.envelope}) = 'object'
    and lower(${t.envelope}->>'eventId') = ${t.eventId}::text
    and ${t.envelope}->>'aggregateType' = ${t.aggregateType}
    and lower(${t.envelope}->>'aggregateId') = ${t.aggregateId}::text
    and (${t.envelope}->>'aggregateVersion')::bigint = ${t.aggregateVersion}, false)`,
    ),
    // B-tree по времени пригоден для временных выборок; он не задаёт порядок обработки
    // и сам по себе не является retention policy. GIN по всему envelope здесь не нужен.
    index('outbox_events_created_at_idx').on(t.createdAt),
  ],
);

/** Курсор/lease на destination и агрегат; writer создаёт cursor=0 и никогда не сбрасывает существующий. */
export const deliveryStreams = pgTable(
  'delivery_streams',
  {
    /**
     * Стабильное text-имя получателя, часть PK потока. CHECK фиксирует inventory.putaway; новая
     * подписка требует миграции и плана обработки истории.
     */
    destination: text('destination').notNull(),

    /**
     * text-тип агрегата, часть PK и составного FK на sequence. Поток включает все типы событий данного
     * агрегата, не только интересные handler.
     */
    aggregateType: text('aggregate_type').notNull(),

    /**
     * UUID агрегата в ключе destination/type/id. Разные агрегаты имеют независимые блокировки/lease и
     * могут обрабатываться параллельно.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    /**
     * bigint mode:number с безопасным JS диапазоном по CHECK. Ноль — исходный курсор, claim берёт
     * только cursor+1; completed не означает физическое исполнение putaway.
     */
    lastCompletedVersion: bigint('last_completed_version', { mode: 'number' }).default(0).notNull(),

    /**
     * Nullable timestamptz срока владения. NULL вместе с token означает отсутствие lease; время
     * сравнивается с часами БД, истечение не отменяет уже удерживаемый row lock.
     */
    leaseUntil: timestamp('lease_until', { withTimezone: true }),

    /**
     * Nullable UUID нового claim: защищает от stale worker после переназначения. Это не пароль;
     * наличие token не доказывает актуальность без проверки срока/статуса/блокировок.
     */
    leaseToken: uuid('lease_token'),
  },
  (t) => [
    primaryKey({ columns: [t.destination, t.aggregateType, t.aggregateId] }),
    foreignKey({
      name: 'delivery_stream_sequence_fk',
      columns: [t.aggregateType, t.aggregateId],
      foreignColumns: [
        outboxAggregateSequences.aggregateType,
        outboxAggregateSequences.aggregateId,
      ],
    }),
    check(
      'delivery_stream_cursor_range',
      sql`${t.lastCompletedVersion} between 0 and ${sql.raw(String(MAX_AGGREGATE_VERSION))}`,
    ),
    check(
      'delivery_stream_destination',
      sql`${t.destination} = ${sql.raw(`'${PUTAWAY_DESTINATION}'`)}`,
    ),
    // Пара NULL/NULL означает свободный поток; заполненная пара — lease.
    // Сам CHECK не проверяет свежесть токена или владельца: это работа протокола под блокировкой.
    check('delivery_stream_lease_pair', sql`(${t.leaseUntil} is null) = (${t.leaseToken} is null)`),
    index('delivery_streams_lease_idx').on(t.leaseUntil),
  ],
);

/** Pending delivery создаётся writer; поля claim/retry/completion использует отдельный worker WMS-109. */
export const outboxDeliveries = pgTable(
  'outbox_deliveries',
  {
    /**
     * UUID/FK на immutable факт. Составной PK(eventId,destination) позволяет один факт разным
     * consumers без копирования envelope.
     */
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.eventId),

    /**
     * text получателя с CHECK; вместе с eventId отделяет состояние каждой доставки. Это логическое
     * имя, не URL внешнего сервиса.
     */
    destination: text('destination').notNull(),

    /**
     * text + CHECK: pending/processing/retry/completed/dead. $type ограничивает только TypeScript;
     * исходный pending назначается DB default, переходами владеет протокол worker.
     */
    status: text('status')
      .$type<'pending' | 'processing' | 'retry' | 'completed' | 'dead'>()
      .default('pending')
      .notNull(),

    /**
     * Общий int4 счётчик claims, включая попытку перед crash. CHECK запрещает минус, SQL-trigger —
     * уменьшение; перед retry при int4 max нужен отказ, иначе следующий increment переполнится.
     */
    attempts: integer('attempts').default(0).notNull(),
    /** WMS-111: attempts на момент разрешённого административного повтора.
     * attempts-base — израсходованный текущий бюджет; 0 <= base <= attempts.
     * Новый base разрешён SQL-trigger только admin на переходе dead → retry. */

    /**
     * int4 сохранённого attempts при административном разрешении повтора. CHECK 0<=base<=attempts;
     * бюджет attempts-base обновляется без потери общего счётчика и истории.
     */
    retryAttemptBase: integer('retry_attempt_base').default(0).notNull(),

    /**
     * timestamptz: не раньше какого момента доставка доступна claim. defaultNow делает новую pending
     * доступной, backoff worker рассчитывает от clock_timestamp БД.
     */
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),

    /**
     * Nullable timestamptz срока claim, согласованный с lease потока. NULL допустим только вместе с
     * NULL token; expired processing автоматически восстанавливает worker.
     */
    leaseUntil: timestamp('lease_until', { withTimezone: true }),

    /**
     * Nullable UUID fencing-токена, общий со stream при claim. Старый worker обязан повторно проверить
     * token под блокировкой и не может подтвердить чужой claim.
     */
    leaseToken: uuid('lease_token'),
    /** Только безопасный диагностический код; произвольные payload/driver errors здесь хранить запрещено. */

    /**
     * Nullable text безопасного технического кода, CHECK длины <=512 символов. NULL — ошибки нет; SQL
     * не валидирует allowlist, безопасные writer/formatter фильтруют произвольный текст.
     */
    lastError: text('last_error'),

    /**
     * Nullable timestamptz завершения доставки. CHECK требует значение тогда и только тогда, когда
     * status=completed; это завершение handler, не всего складского процесса.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.destination] }),
    check(
      'outbox_delivery_destination',
      sql`${t.destination} = ${sql.raw(`'${PUTAWAY_DESTINATION}'`)}`,
    ),
    check(
      'outbox_delivery_status',
      sql`${t.status} in ('pending', 'processing', 'retry', 'completed', 'dead')`,
    ),
    check('outbox_delivery_attempts', sql`${t.attempts} >= 0`),
    check(
      'outbox_retry_attempt_base',
      sql`${t.retryAttemptBase} >= 0 and ${t.retryAttemptBase} <= ${t.attempts}`,
    ),
    check('outbox_delivery_lease_pair', sql`(${t.leaseUntil} is null) = (${t.leaseToken} is null)`),
    check(
      'outbox_delivery_completion',
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check('outbox_delivery_error_length', sql`length(${t.lastError}) <= 512`),
    // Частичный B-tree хранит только активные статусы, уменьшая индекс при накоплении completed/dead.
    // Планировщик обязан учитывать тот же предикат; индекс не заменяет SKIP LOCKED и cursor+1.
    index('outbox_deliveries_available_idx')
      .on(t.availableAt)
      .where(sql`${t.status} in ('pending', 'retry', 'processing')`),
  ],
);

/** Неизменяемая история административного повтора: оператор, причина, прежние attempts/base/error
 * и связь с аудитом фиксируются той же транзакцией, что перевод доставки в retry.
 * FK (eventId, consumer) адресует конкретную доставку. SQL-trigger запрещает UPDATE/DELETE/TRUNCATE;
 * ограничения не защищают журнал от администратора БД. Retention/удаление пока не реализованы. */
export const outboxRecoveryActions = pgTable(
  'outbox_recovery_actions',
  {
    /**
     * UUID вмешательства, DB defaultRandom. Отдельная запись для каждого успешного административного
     * commit, а не перезапись последней причины в delivery.
     */
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * UUID исходного факта; составной FK с consumer связывает запись с существующей доставкой, не с
     * произвольным UUID.
     */
    eventId: uuid('event_id').notNull(),
    /**
     * text получателя в том же составном FK. История относится к конкретной доставке, даже если
     * событие имеет несколько подписчиков.
     */
    consumer: text('consumer').notNull(),

    /**
     * UUID оператора, утверждённый локальным вызывающим и перенесённый в аудит. FK на каталог
     * пользователей отсутствует; UUID не доказывает аутентификацию.
     */
    operatorId: uuid('operator_id').notNull(),
    /**
     * text технической причины: CHECK slug и <=96 символов. Не свободный текст инцидента с
     * персональными данными.
     */
    reasonCode: text('reason_code').notNull(),
    /**
     * Новый UUID административной команды, отдельный от correlationId исходного envelope; нужен для
     * связи действий восстановления.
     */
    correlationId: uuid('correlation_id').notNull(),

    /**
     * int4 общего attempts до retry. CHECK согласует с previousRetryAttemptBase, чтобы историю
     * исчерпанного бюджета можно было восстановить.
     */
    previousAttempts: integer('previous_attempts').notNull(),
    /**
     * int4 предыдущего base до открытия нового бюджета. Не текущий base доставки: поле сохраняет
     * объяснение прежних попыток.
     */
    previousRetryAttemptBase: integer('previous_retry_attempt_base').notNull(),

    /**
     * Nullable text прежнего безопасного кода <=512 символов. История сохраняет его даже после
     * успешной обработки, которая очистит last_error доставки.
     */
    previousError: text('previous_error'),
    /**
     * Обязательный UUID/FK на аудит вмешательства. FK проверяет ссылку, а атомарность
     * history/audit/scheduling обеспечивает общий transaction context.
     */
    auditId: uuid('audit_id')
      .notNull()
      .references(() => auditEntries.id),

    /**
     * timestamptz вставки истории, defaultNow от начала административной транзакции. Не следует
     * сортировать глобальные commits только по этой дате.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.eventId, t.consumer],
      foreignColumns: [outboxDeliveries.eventId, outboxDeliveries.destination],
    }),
    check(
      'recovery_reason_code',
      sql`${t.reasonCode} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(${t.reasonCode}) <= 96`,
    ),
    check(
      'recovery_attempts',
      sql`${t.previousRetryAttemptBase} >= 0 and ${t.previousRetryAttemptBase} <= ${t.previousAttempts}`,
    ),
    check('recovery_error_length', sql`length(${t.previousError}) <= 512`),
  ],
);
