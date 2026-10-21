/** @file Единая фабрика pg Pool/Drizzle для Nest и CLI; владелец обязан вызвать pool.end(). */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/** Создаёт bounded pool без подключения; safe error listeners покрывают idle и checked-out clients без скрытого retry. */
export function createDatabaseConnection(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'warehouse-controller',
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  // Pool error listener покрывает idle clients, но checked-out client между запросами
  // может получить собственный error event (например, pg_terminate_backend).
  // Listener предотвращает uncaught EventEmitter error без утечки driver/credentials.
  // pg помечает соединение непригодным: следующий query/commit отвергнет транзакцию,
  // поэтому этот обработчик не превращает потерю соединения в успешный commit/retry.
  pool.on('connect', client => {
    client.on('error', () => console.error('Database client connection error'));
  });
  pool.on('error', () => console.error('Database pool connection error'));
  return { pool, db: drizzle(pool, { schema }) };
}
