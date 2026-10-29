/** @file Наблюдение реального PostgreSQL lock wait в integration tests; не заменяет синхронизацию таймером. */
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseHarness } from './database-harness';
/**
 * Ждёт заблокированный SQL указанной таблицы в текущей disposable БД, максимум 5 секунд.
 * @param relation Серверное имя таблицы из test code, передаётся параметром, не SQL interpolation.
 * @param minimum Число одновременно ожидающих statements; 2 доказывает конкуренцию обоих callers перед снятием barrier.
 * @throws Error если конкурентный statement не начал ждать; фиксированный sleep не доказывает race.
 */
export async function waitForDatabaseLock(
  database: DatabaseHarness,
  relation: string,
  minimum = 1,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await database.connection.pool.query(
      `select count(*) >= $2 as blocked from pg_stat_activity
      where datname=current_database() and wait_event_type='Lock' and position($1 in query)>0
      and cardinality(pg_blocking_pids(pid))>0`,
      [relation, minimum],
    );
    if (result.rows[0].blocked) return;
    await delay(10);
  }
  throw new Error('Concurrent database statement did not wait on lock');
}
