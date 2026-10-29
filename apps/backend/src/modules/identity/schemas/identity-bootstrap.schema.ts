/** @file Одноразовый retained marker первого system admin; не таблица runtime сессий и не dev seed.
 * Единственный key=initial создаётся атомарно с admin/audit. Права и trigger новой custom migration
 * запрещают runtime UPDATE/DELETE/TRUNCATE; DBA способен обойти защиту. Повторный bootstrap не является recovery.
 * Общие нюансы SQL/JS/JSON: docs/database-types.md; flow: docs/flows/identity.md. */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
/** Одноразовый маркер bootstrap не позволяет повторить создание первого администратора после очистки users. */
export const identityBootstrap = pgTable(
  'identity_bootstrap',
  {
    /** Text PK без NULL/default, CHECK разрешает только initial: одна строка без sequence и случайного id; значение задаёт bootstrap repository. */
    key: text('key').primaryKey(),
    /** Обязательный timestamptz, defaultNow — начало транзакции, не commit. pg Date/UTC ISO; дата регистрации bootstrap не является секретом или readiness API. */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check('identity_bootstrap_key', sql`${t.key} = 'initial'`)],
);
