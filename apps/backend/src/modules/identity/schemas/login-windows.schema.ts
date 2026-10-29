/** @file Общие для replicas окна login throttling: hash ключа, bounded attempts и время сброса по PostgreSQL.
 * PK сериализует upsert одной области; int4 saturation не даёт переполнить счётчик. Сначала лимит IP,
 * затем login; отказ фиксирует попытку, не rollback. Это не журнал credentials и не полная DDoS-защита.
 * Общие нюансы SQL/JS/JSON: docs/database-types.md; flow: docs/flows/identity.md. */
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
/** Rate-limit общий для API replicas: нет Redis и нет сбрасываемого при рестарте process-only counter. */
export const loginWindows = pgTable(
  'auth_login_windows',
  {
    /** Text PK без NULL/default: digest login/IP с префиксом области исключает коллизии пространств. Plaintext не нужен для счётчика; hash адреса не обещает анонимизацию. */
    key: text('key').primaryKey(),
    /** Обязательный int4 без default: количество попыток 0..1000 по CHECK, точно представимо JS number/JSON integer. Repository насыщает счётчик, предотвращая переполнение под атакой. */
    attempts: integer('attempts').notNull(),
    /** Обязательный timestamptz без default: конец 15-minute окна по clock_timestamp БД. pg Date/UTC ISO, не часы браузера; истечение само по себе не удаляет строку. */
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('identity_login_window_attempts', sql`${t.attempts} between 0 and 1000`)],
);
