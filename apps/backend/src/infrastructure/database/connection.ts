/** @file Единая фабрика pg Pool/Drizzle для Nest и CLI; владелец обязан вызвать pool.end(). */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/** Создаёт bounded pool без немедленного подключения; ошибки idle connections логируются без credentials. */
export function createDatabaseConnection(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'warehouse-controller',
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  pool.on('error', () => console.error('Database pool connection error'));
  return { pool, db: drizzle(pool, { schema }) };
}
