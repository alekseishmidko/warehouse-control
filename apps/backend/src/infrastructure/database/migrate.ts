/** @file CLI миграций: применяет generated SQL, закрывает pool и выдаёт безопасную ошибку. */
import { logEvent } from '../logging/runtime-logger';
import '../logging/startup';
import { resolve } from 'node:path';
import { applySerializedMigrations } from './serialized-migrations';
import { loadEnvironment } from '../config/environment';
import { createDatabaseConnection } from './connection';

/** Применяет journal под session lock; параллельный CLI ждёт, затем перечитывает журнал. */
async function main(): Promise<void> {
  const { pool } = createDatabaseConnection(loadEnvironment().databaseUrl);
  try {
    await applySerializedMigrations(pool, resolve(__dirname, '../../../drizzle'));
    logEvent('database.migrated');
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  logEvent('process.failed');
  process.exitCode = 1;
});
