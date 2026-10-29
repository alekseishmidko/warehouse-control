/** @file Серверные сессии: в БД digest capability, абсолютный/idle сроки и дата отзыва, без browser token.
 * Роли не копируются в session: каждый запрос читает актуальные grants. CHECK связывает сроки,
 * но не отзывает сессию по часам сам: valid вычисляет SQL repository. FK не удаляет историю каскадно.
 * Индекс user_id ускоряет revoke-all/поиск сессий субъекта; он не UNIQUE, несколько сессий разрешены.
 * UNIQUE token_hash индексирует поиск по cookie digest; CHECK формата не доказывает случайность token.
 * Общие нюансы SQL/JS/JSON: docs/database-types.md; flow: docs/flows/identity.md. */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
/** Browser token остаётся только в cookie; таблица хранит digest и server-side сроки/отзыв. */
export const sessions = pgTable(
  'sessions',
  {
    /** Несекретный UUID, PK без NULL/default: сервис генерирует строковый id для адресного отзыва; он не заменяет browser token. */
    id: uuid('id').primaryKey(),
    /** Обязательный UUID FK без default, JS/JSON string. Ссылается на users; права читаются актуальными, не копируются в session JSON. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Обязательный text без default: SHA-256 случайного 256-bit token, ровно 64 lowercase hex по CHECK. UNIQUE защищает идентичность; быстрого digest достаточно только для высокоэнтропийного token. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Обязательный timestamptz deadline из явной runtime policy, без DB default TTL. Сравнивается с DB clock; pg Date/UTC ISO не хранит исходный timezone. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    /** Обязательный timestamptz без default, sliding idle deadline ограничен absoluteExpiresAt. Единица policy — секунды, сравнение использует часы PostgreSQL после получения lock. */
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    /** Nullable timestamptz без default: SQL NULL — не отозвана. Дата сохраняет факт отзыва, а не стирает строку; pg возвращает Date либо null. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Обязательный timestamptz с defaultNow (начало транзакции): диагностика, не capability и не точный порядок commit. pg Date, JSON UTC ISO. */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('identity_token_hash', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('identity_deadline_order', sql`${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`),
    index('identity_sessions_user_idx').on(t.userId),
  ],
);
