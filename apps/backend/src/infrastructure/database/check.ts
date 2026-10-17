/** @file Read-only CLI проверки подключения и baseline; завершает pool и скрывает driver errors. */
import { sql } from 'drizzle-orm';
import { loadEnvironment } from '../config/environment';
import { createDatabaseConnection } from './connection';
import { applicationMetadata } from './schema';

/** Читает версию сервера и таблицу baseline без изменения данных. */
async function main(): Promise<void> {
  const { pool, db } = createDatabaseConnection(loadEnvironment().databaseUrl);
  try {
    const result = await db.execute<{ version: string }>(sql`select current_setting('server_version') as version`);
    await db.select().from(applicationMetadata).limit(1);
    console.log(`Database check passed (PostgreSQL ${result.rows[0].version})`);
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  console.error('Database check failed. Check configuration, connectivity and applied migrations.');
  process.exitCode = 1;
});
