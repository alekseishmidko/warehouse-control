/** @file WMS-506: read-only boundary и проверяемый backup/restore только disposable Testcontainers БД.
 * Все mutations складских данных выполняют production owners. Docker exec не принимает
 * host DATABASE_URL: контейнер передан владельцем test harness, пароль не попадает в argv.
 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import type { DatabaseHarness } from './database-harness';

const execute = promisify(execFile);
/** Останавливает/возобновляет только disposable broker из fixture. Docker pause сохраняет storage/port,
 * поэтому timeout producer проверяет реальный network outage без удаления контейнера/данных. */
export async function setCutoverBrokerPaused(containerId: string, paused: boolean): Promise<void> {
  await execute('docker', [paused ? 'pause' : 'unpause', containerId], { timeout: 15000 });
}
/** Только allowlisted metadata; envelope/session/raw не входят в operator evidence. */
export interface TransportBoundary {
  consumer: string;
  streams: Array<{
    aggregateId: string;
    lastVersion: string;
    consumerCursor: string;
    localCursor: string;
    markers: number;
  }>;
  events: Array<{ eventId: string; aggregateType: string; aggregateId: string; version: string }>;
  pendingEffects: string[];
  localPending: string[];
  markers: Array<{ consumer: string; eventId: string }>;
  cursors: Array<{ consumer: string; aggregateType: string; aggregateId: string; version: string }>;
  transportStreams: Array<{
    destination: string;
    aggregateType: string;
    aggregateId: string;
    version: string;
  }>;
  deliveries: Array<{
    eventId: string;
    destination: string;
    status: string;
    attempts: number;
    retryAttemptBase: number;
  }>;
  checks: Record<string, number>;
  inventory: {
    balances: string;
    allocations: string;
    movements: string;
    tasks: string;
    taskCount: number;
    movementCount: number;
    onHand: number;
    reserved: number;
  };
}
/** Тот же SQL, который оператор запускает из runbook. Единственный SELECT не пишет БД.
 * Тип результата контролируется локальным SQL, не принимается от внешнего Kafka input. */
export async function captureTransportBoundary(pool: Pool): Promise<TransportBoundary> {
  const source = await readFile(resolve('../../docs/examples/transport-boundary.sql'), 'utf8');
  return (await pool.query<{ boundary: TransportBoundary }>(source)).rows[0].boundary;
}
/** Проверяет отсутствие запрещённых расхождений; backlog сам по себе допустим при handover.
 * Любая ненулевая проверка запрещает продолжить cutover; неизвестная новая проверка также исполняется. */
export function assertSafeBoundary(boundary: TransportBoundary): void {
  for (const [name, count] of Object.entries(boundary.checks))
    if (count !== 0) throw new Error(`Unsafe transport boundary: ${name}`);
}
/** Ограниченный polling наблюдаемого commit/readiness. Не имитирует barrier случайным sleep. */
export async function observeCutover(
  check: () => Promise<boolean>,
  timeout = 45000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Cutover observation deadline exceeded');
    await delay(50);
  }
}
/** Создаёт custom-format archive внутри disposable PG и восстанавливает в новую БД.
 * Не перезаписывает исходную БД, не запускает consumers на restore. Archive удаляется finally.
 * @returns SHA256/размер и восстановленный boundary; backup проверен чтением, не только pg_dump exit0.
 * @throws Ненулевой Docker/pg_dump/restore/SQL status. Ошибка cleanup также означает отказ.
 */
export async function verifyCutoverBackup(database: DatabaseHarness) {
  const url = new URL(database.config.databaseUrl);
  const name = `restore_${randomUUID().replaceAll('-', '')}`;
  const archive = `/tmp/${name}.dump`;
  const docker = async (...args: string[]) =>
    execute('docker', ['exec', database.containerId, ...args], {
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
  let restored: Pool | undefined;
  let created = false;
  try {
    await docker('pg_dump', '-U', url.username, '-d', url.pathname.slice(1), '-Fc', '-f', archive);
    const bytes = (await docker('cat', archive)).stdout;
    await docker('createdb', '-U', url.username, name);
    created = true;
    // Роли уже созданы migrations исходной БД в том же disposable server. Внешний restore
    // требует отдельного globals/roles плана; --no-owner не восстанавливает отсутствующие roles.
    await docker('pg_restore', '-U', url.username, '-d', name, '--exit-on-error', archive);
    url.pathname = `/${name}`;
    restored = new Pool({ connectionString: url.toString(), max: 1 });
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      boundary: await captureTransportBoundary(restored),
    };
  } finally {
    await restored?.end();
    try {
      if (created) await docker('dropdb', '-U', url.username, name);
    } finally {
      await docker('rm', '-f', archive);
    }
  }
}
