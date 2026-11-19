/** @file WMS-601: baseline schema → candidate migrations; старый API/worker продолжает commit после upgrade.
 * Baseline экспортируется Git archive без .env/.git. Его зависимости устанавливаются frozen отдельно.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createDatabaseHarness, type DatabaseHarness } from '../support/database-harness';
import { applySerializedMigrations } from '@backend/infrastructure/database/serialized-migrations';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { captureTransportBoundary, assertSafeBoundary } from '../support/cutover.fixture';
const execute = promisify(execFile);
jest.setTimeout(240000);

test('previous release upgrades without losing operations', async () => {
  const root = resolve('../..');
  const { releaseBase }: { releaseBase(root: string): string } = require(
    resolve('../../scripts/pr-checks/compatibility.cjs'),
  );
  const baseCommit = releaseBase(root);
  const directory = await mkdtemp(join(tmpdir(), 'wms-release-'));
  let database: DatabaseHarness | undefined;
  const env = { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0', CI: 'true' };
  /** Каждый tool bounded, args без shell. Диагностика error не содержит DATABASE_URL, так как URL только в env. */
  const run = (command: string, args: string[], cwd = directory, extra: NodeJS.ProcessEnv = {}) =>
    execute(command, args, {
      cwd,
      env: { ...env, ...extra },
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  try {
    const archive = join(directory, 'release.tar');
    await run('git', ['archive', '--format=tar', '--output', archive, baseCommit], root);
    await run('tar', ['-xf', archive, '-C', directory]);
    await run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline']);
    await run('pnpm', ['--filter', '@warehouse/backend', 'build']);
    database = await createDatabaseHarness(join(directory, 'apps/backend/drizzle'));
    const current = database;
    const oldRuntime = async () => {
      const result = await run(
        process.execPath,
        [resolve('.test-dist/test/support/release-runtime.fixture.js')],
        resolve('.'),
        {
          NODE_ENV: 'test',
          DATABASE_URL: current.config.databaseUrl,
          WMS_RELEASE_BASE_DIRECTORY: directory,
          LOG_LEVEL: 'fatal',
          OTEL_SDK_DISABLED: 'true',
          WORKER_POLL_INTERVAL_MS: '20',
        },
      );
      return JSON.parse(result.stdout.trim()) as { receiptId: string; eventId: string };
    };
    const first = await oldRuntime();
    const before = await captureTransportBoundary(current.connection.pool);
    assertSafeBoundary(before);
    expect(before.inventory.onHand).toBe(10);
    expect(before.inventory.taskCount).toBe(1);
    // Единственный migrator использует production session lock. Повторный запуск безопасен.
    await applySerializedMigrations(current.connection.pool, resolve('drizzle'));
    await applySerializedMigrations(current.connection.pool, resolve('drizzle'));
    const upgraded = await captureTransportBoundary(current.connection.pool);
    assertSafeBoundary(upgraded);
    expect(upgraded.events).toEqual(before.events);
    expect(upgraded.markers).toEqual(before.markers);
    expect(upgraded.inventory).toEqual(before.inventory);
    const second = await oldRuntime();
    expect(second.receiptId).not.toBe(first.receiptId);
    const app = await current.createHttpApplication();
    await postedReceiptFixture(app);
    const worker = await current.createWorkerApplication();
    for (const claim of await worker.get(WorkerService).claim())
      expect(await worker.get(WorkerService).process(claim)).toBe('completed');
    const after = await captureTransportBoundary(current.connection.pool);
    assertSafeBoundary(after);
    expect(after.inventory.onHand).toBe(30);
    expect(after.inventory.taskCount).toBe(3);
    expect(after.markers).toHaveLength(3);
    expect(after.events).toEqual(expect.arrayContaining(before.events));
  } finally {
    try {
      await database?.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
