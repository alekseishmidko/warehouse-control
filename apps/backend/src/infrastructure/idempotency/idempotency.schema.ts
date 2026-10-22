/** @file HTTP command dedup storage: уникальный scope, hash и success snapshot в той же транзакции, без TTL. */
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
/** Pending row не коммитится сервисом; completed snapshot защищён custom trigger от перезаписи. */
export const httpIdempotency = pgTable('http_idempotency', {
  // Identity команды: correlationId сюда не входит, каждая HTTP попытка может иметь свой ID.
  actorType: text('actor_type').notNull(), actorId: uuid('actor_id').notNull(),
  operation: text('operation').notNull(), key: uuid('key').notNull(), requestHash: text('request_hash').notNull(),
  // SQL NULL во всех result fields обозначает pending внутри незавершённой транзакции.
  // После work сервис заполняет их одним UPDATE; JSONB null body является допустимым результатом.
  statusCode: integer('status_code'), body: jsonb('body'), headers: jsonb('headers').$type<{ location?: string }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, t => [
  // PK одновременно ограничивает identity и сериализует concurrent INSERT одинакового scope.
  primaryKey({ columns: [t.actorType, t.actorId, t.operation, t.key] }),
  check('http_idempotency_actor', sql`${t.actorType} in ('user','system')`),
  check('http_idempotency_operation', sql`${t.operation} ~ '^[a-z][a-z0-9.-]{0,95}$'`),
  check('http_idempotency_hash', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  // CHECK не разрешает частично заполненный response. Commit pending предотвращает
  // service protocol; immutable/retention guards реализует отдельная custom migration.
  check('http_idempotency_result', sql`(${t.statusCode} is null and ${t.body} is null and ${t.headers} is null and ${t.completedAt} is null)
    or (${t.statusCode} in (200,201,202) and ${t.statusCode} is not null and ${t.body} is not null
      and ${t.headers} is not null and ${t.completedAt} is not null)`),
]);
