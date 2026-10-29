/** @file CLI миграций: применяет generated SQL, закрывает pool и выдаёт безопасную ошибку. */
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnvironment } from '../config/environment';
import { createDatabaseConnection } from './connection';

/** Применяет только ещё не записанные в Drizzle journal миграции; запускать одним процессом. */
async function main(): Promise<void> {
  const { pool, db } = createDatabaseConnection(loadEnvironment().databaseUrl);
  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, '../../../drizzle') });
    console.log('Database migrations completed');
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  console.error(
    'Database migration failed. Check configuration, database availability and migration files.',
  );
  process.exitCode = 1;
});
