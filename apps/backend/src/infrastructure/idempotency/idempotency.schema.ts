/** @file Схема HTTP-идемпотентности: scope команды, отпечаток запроса и атомарно сохранённый ответ.
 * Поля ниже объясняют предметный смысл, выбор типа и локальные ограничения.
 * Общие нюансы типов/NULL/индексов: docs/database-types.md.
 * Комментарии не меняют DDL: applied migrations остаются источником исполнения SQL. */
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
/** Pending row не коммитится сервисом; completed snapshot защищён custom trigger от перезаписи. */
export const httpIdempotency = pgTable(
  'http_idempotency',
  {
    // Identity команды: correlationId сюда не входит, каждая HTTP попытка может иметь свой ID.

    /**
     * text user/system: различает пространства actorId и входит в PK области команды. Серверный
     * контекст определяет значение, не HTTP body.
     */
    actorType: text('actor_type').notNull(),
    /**
     * UUID субъекта входит в scope: одинаковый key у разных субъектов не склеивает команды. Сам UUID
     * не выполняет авторизацию.
     */
    actorId: uuid('actor_id').notNull(),

    /**
     * Стабильный text-код сценария, ограниченный CHECK. Тот же key разрешён у другого operation;
     * URL/correlationId не подменяют код операции.
     */
    operation: text('operation').notNull(),
    /**
     * UUID HTTP Idempotency-Key. Уникален только в составном scope actorType/actorId/operation/key, а
     * не глобально; это не eventId.
     */
    key: uuid('key').notNull(),
    /**
     * SHA-256 нормализованного запроса как text: 64 hex-символа проверяет CHECK. Хранится отпечаток,
     * не исходный request/секреты; hash не является шифрованием.
     */
    requestHash: text('request_hash').notNull(),
    // SQL NULL во всех result fields обозначает pending внутри незавершённой транзакции.
    // После work сервис заполняет их одним UPDATE; JSONB null body является допустимым результатом.

    /**
     * Nullable int4 HTTP-статуса; CHECK допускает сохранённые успехи 200/201/202. SQL NULL означает
     * незавершённый результат внутри текущей транзакции.
     */
    statusCode: integer('status_code'),
    /**
     * JSONB снимка ответа, а не ORM-класс. SQL NULL означает pending, JSON null допустим как готовый
     * body; порядок ключей/пробелы не сохраняются.
     */
    body: jsonb('body'),
    /**
     * JSONB только разрешённых заголовков результата, сейчас relative location. $type не фильтрует
     * SQL-ввод; HttpCommandsService выбирает безопасные поля.
     */
    headers: jsonb('headers').$type<{ location?: string }>(),

    /**
     * timestamptz начала хранения команды. Нет автоматического TTL/удаления: удаление позволило бы
     * заново выполнить прежний key.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    /**
     * Nullable timestamptz завершённого снимка; CHECK связывает со всеми result-полями. Заполнение не
     * означает отдельный commit: результат фиксируется вместе с бизнес-эффектом.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    // PK одновременно ограничивает identity и сериализует concurrent INSERT одинакового scope.
    primaryKey({ columns: [t.actorType, t.actorId, t.operation, t.key] }),
    check('http_idempotency_actor', sql`${t.actorType} in ('user','system')`),
    check('http_idempotency_operation', sql`${t.operation} ~ '^[a-z][a-z0-9.-]{0,95}$'`),
    check('http_idempotency_hash', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
    // JSONB null отличается от SQL NULL: готовый body=null проходит ветку IS NOT NULL.
    // Одного CHECK недостаточно, чтобы запретить commit целой pending-строки: это обязанность сервиса.
    // CHECK не разрешает частично заполненный response. Commit pending предотвращает
    // service protocol; immutable/retention guards реализует отдельная custom migration.
    check(
      'http_idempotency_result',
      sql`(${t.statusCode} is null and ${t.body} is null and ${t.headers} is null and ${t.completedAt} is null)
    or (${t.statusCode} in (200,201,202) and ${t.statusCode} is not null and ${t.body} is not null
      and ${t.headers} is not null and ${t.completedAt} is not null)`,
    ),
  ],
);
