/** @file Реальные child processes + PostgreSQL: SIGTERM drain/deadline, no new claim и crash до/после commit. */
import { fork, ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { useDatabaseSuite } from '../support/database-harness';
import { outboxFixture } from '../support/outbox.fixture';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import { TRANSACTION_RUNNER, TransactionRunner } from '@backend/shared/transactions/transaction.port';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { sql } from 'drizzle-orm';
const database = useDatabaseSuite();
let outbox: OutboxService; let runner: TransactionRunner;
beforeAll(async () => { const app = await database().createHttpApplication(); outbox = app.get(OutboxService); runner = app.get(TRANSACTION_RUNNER); });

/** Child env явно выключает dev actor; это отдельный процесс, parent env/config не изменяются. */
function child(hard = false) {
  const process = fork(resolve('.test-dist/test/support/worker-process.fixture.js'), [], {
    env: { ...global.process.env, NODE_ENV: 'test', DATABASE_URL: database().config.databaseUrl, DEV_ACTOR_ENABLED: 'false',
      WORKER_BATCH_SIZE: '1', WORKER_POLL_INTERVAL_MS: '10', WORKER_LEASE_MS: '30000',
      WORKER_TRANSACTION_TIMEOUT_MS: hard ? '1000' : '10000', WORKER_SHUTDOWN_TIMEOUT_MS: hard ? '1500' : '15000' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  // Регистрируем listeners сразу, до первой event-loop итерации: не теряем быстрые IPC/exit.
  const exited = new Promise<number | null>((resolve, reject) => { process.once('exit', resolve); process.once('error', reject); });
  const handling = new Promise<void>(resolve => { process.on('message', message => { if (message === 'handling') resolve(); }); });
  const committed = new Promise<void>(resolve => { process.on('message', message => { if (message === 'committed') resolve(); }); });
  let output = ''; process.stdout?.on('data', value => { output += value.toString(); }); process.stderr?.on('data', value => { output += value.toString(); });
  return { process, exited, handling, committed, output: () => output };
}
/** Ограничивает ожидание child/barrier; timeout — failure, timer всегда освобождается. */
async function bounded<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker child timed out')), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** Даже failed assertion не оставляет child/открытую transaction и не мешает harness reset. */
async function cleanup(process: ChildProcess, exited: Promise<unknown>): Promise<void> {
  if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
  await bounded(exited);
}

test.each([false, true])('SIGTERM hard=%j stops claim, drains or exits boundedly, closes DB resources', async hard => {
  await runner.run(context => outbox.append(context, outboxFixture()));
  const running = child(hard);
  try {
    await bounded(running.handling);
    // Новое событие добавлено после начала handler: signal обязан запретить следующий claim.
    const next = await runner.run(context => outbox.append(context, outboxFixture()));
    running.process.kill('SIGTERM');
    if (!hard) running.process.send('release');
    expect(await bounded(running.exited)).toBe(hard ? 1 : 0);
    expect(running.output()).not.toContain(database().config.databaseUrl);
    const rows = (await database().connection.pool.query('select event_id,status,attempts from outbox_deliveries')).rows;
    expect(rows.find(row => row.event_id === next.eventId)).toMatchObject({ status: 'pending', attempts: 0 });
    expect((await database().connection.pool.query('select count(*)::int as n from processed_events')).rows[0].n).toBe(hard ? 0 : 1);
    expect((await database().connection.pool.query('select count(*)::int as n from application_metadata')).rows[0].n).toBe(hard ? 0 : 1);
    // Read-only evidence: завершившийся child не оставил idle-in-transaction locks.
    expect((await database().connection.pool.query("select count(*)::int as n from pg_stat_activity where state='idle in transaction'")).rows[0].n).toBe(0);
  } finally { await cleanup(running.process, running.exited); }
});

test('SIGKILL before commit recovers expired lease; SIGKILL after commit does not repeat effect', async () => {
  const event = await runner.run(context => outbox.append(context, outboxFixture()));
  const before = child();
  try {
    await bounded(before.handling); before.process.kill('SIGKILL'); await bounded(before.exited);
    expect((await database().connection.pool.query('select count(*)::int as n from application_metadata')).rows[0].n).toBe(0);
  } finally { await cleanup(before.process, before.exited); }
  // Test-only expiry после гарантированно умершего child; production ждёт PostgreSQL clock.
  await database().connection.pool.query("update delivery_streams set lease_until=clock_timestamp()-interval '1 second'");
  await database().connection.pool.query("update outbox_deliveries set lease_until=clock_timestamp()-interval '1 second'");
  const app = await database().createWorkerApplication([{ destination: 'inventory.putaway', handle: async (context, message) => {
    await transactionClient(context).execute(sql`insert into application_metadata(key,value) values(${message.eventId},'1')`);
  } }]);
  try {
    const worker = app.get(WorkerService); const [claim] = await worker.claim(); expect(claim.eventId).toBe(event.eventId);
    expect(await worker.process(claim)).toBe('completed');
    // Завершённый факт переживает падение любого следующего idle process; прежний token уже не действует.
    expect(await worker.process(claim)).toBe('stale');
    const second = await runner.run(context => outbox.append(context, outboxFixture()));
    const after = child();
    try {
      // Убиваем именно процесс, который уже COMMIT-нул effect/marker/cursors/completion.
      await bounded(after.handling); after.process.send('release'); await bounded(after.committed);
      after.process.kill('SIGKILL'); await bounded(after.exited);
    } finally { await cleanup(after.process, after.exited); }
    expect(await worker.claim()).toEqual([]);
    expect((await database().connection.pool.query('select key,value from application_metadata')).rows)
      .toEqual(expect.arrayContaining([{ key: event.eventId, value: '1' }, { key: second.eventId, value: '1' }]));
    expect((await database().connection.pool.query('select count(*)::int as n from processed_events')).rows[0].n).toBe(2);
  } finally { await app.close(); }
});
