/** @file Межпроцессная сериализация CLI migrations одной БД: session advisory lock и Drizzle на одном соединении. */
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Применяет journal migrations под единственным session lock, включая чтение journal.
 * @param pool Пул владельца CLI/tests; вызывающий закрывает pool, функция уничтожает borrowed client.
 * @param migrationsFolder Доверенный путь release к SQL/journal, не HTTP input.
 * @throws SQL/file ошибка выходит без retry. Release client уничтожается даже при отказе:
 * PostgreSQL снимает session lock при закрытии соединения, он не попадёт в общий pool.
 * Lock timeout 120s ограничивает ожидание другого migrator; Job задаёт общий deadline.
 */
export async function applySerializedMigrations(
  pool: Pool,
  migrationsFolder: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("set lock_timeout = '120s'");
    // Два int4 — отдельный namespace WMS/migrations; lock действует только в текущей БД.
    await client.query('select pg_advisory_lock(1464685363, 302)');
    // Нельзя передать pool: journal и SQL должны выполняться на соединении, удерживающем lock.
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    client.release(true);
  }
}
