/** @file Пользователи identity: стабильный UUID, нормализованный уникальный login, password hash и серверные флаги.
 * Это не складские роли: systemAdmin даёт только identity administration. Блокировка не удаляет историю.
 * SQL проверяет формат hash, но не его происхождение и не качество пароля; это задача AuthService/UsersService.
 * Общие нюансы SQL/JS/JSON: docs/database-types.md; flow: docs/flows/identity.md. */
import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
/** Пользователь сохраняется при блокировке; история аудита не удаляется каскадно. */
export const users = pgTable(
  'users',
  {
    /** UUID (16 bytes) назначает сценарий; PK исключает NULL, DB default нет. В JS/JSON это строка, не число и не секрет. */
    id: uuid('id').primaryKey(),
    /** Обязательный text без default: lowercase ASCII 3..64 символа. Не char с padding; CHECK фиксирует формат, UNIQUE сериализует гонку создания. */
    login: text('login').notNull().unique(),
    /** Обязательный text без default: версионированные параметры, salt и scrypt hash. CHECK фиксирует формат; plaintext/быстрый SHA пароля запрещены, в JSON ответов поле не попадает. */
    passwordHash: text('password_hash').notNull(),
    /** Обязательный SQL boolean, default true; в JS/JSON boolean, не 0/1. false блокирует сессии на следующей проверке без удаления истории. */
    active: boolean('active').default(true).notNull(),
    /** Обязательный boolean, default false: создание пользователя не выдаёт глобальные identity-полномочия автоматически. true не означает роль на складе. */
    systemAdmin: boolean('system_admin').default(false).notNull(),
    /** timestamptz — обязательный момент вставки, defaultNow берёт начало транзакции, не commit. Хранит момент без исходного timezone; pg возвращает Date, JSON сериализует UTC ISO. */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('identity_login', sql`${t.login} ~ '^[a-z0-9][a-z0-9._-]{2,63}$'`),
    check(
      'identity_password_hash',
      sql`${t.passwordHash} ~ '^scrypt[$]131072[$]8[$]1[$][a-f0-9]{32}[$][a-f0-9]{128}$'`,
    ),
  ],
);
