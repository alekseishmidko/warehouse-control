/** @file AC-404-01/02: недоступность login disposable PostgreSQL и восстановление подтверждённой приёмки. */
import request from 'supertest';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
const database = useDatabaseSuite();

/** Никакой рабочей БД: роль принадлежит только harness, cleanup остаётся у него. */
test('AC-404-01/02: DB unavailable preserves confirmed receipt and recovers one handler effect', async () => {
  const db = database();
  const api = await db.createHttpApplication();
  const worker = (await db.createWorkerApplication()).get(WorkerService);
  const { document } = await postedReceiptFixture(api);
  const started = performance.now();
  // Login outage сохраняет host port ephemeral Docker binding. Admin connection удерживается
  // только для восстановления LOGIN; все остальные соединения этой disposable БД разрываются.
  const admin = await db.connection.pool.connect();
  const role = (await admin.query<{ name: string }>('select current_user as name')).rows[0].name;
  const identifier = '"' + role.replaceAll('"', '""') + '"';
  try {
    await admin.query(`alter role ${identifier} nologin`);
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()',
    );
    await request(api.getHttpServer()).get('/health/ready').expect(503);
    await request(api.getHttpServer()).get('/health/live').expect(200);
    await expect(worker.claim()).rejects.toBeDefined();
  } finally {
    await admin.query(`alter role ${identifier} login`);
    admin.release();
  }
  const deadline = performance.now() + 30000;
  let ready = false;
  while (performance.now() < deadline) {
    try {
      await db.connection.pool.query('select 1');
      ready = true;
      break;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  expect(ready).toBe(true);
  await request(api.getHttpServer()).get('/health/ready').expect(200);
  const [claim] = await worker.claim();
  expect(claim.eventId).toBe(document.postedEventId);
  expect(await worker.process(claim)).toBe('completed');
  const {
    rows: [result],
  } = await db.connection.pool.query(`select
    (select count(*)::int from receipts where status='posted') receipts,
    (select sum(on_hand)::int from stock_balances) stock,
    (select count(*)::int from stock_movements) movements,
    (select count(*)::int from putaway_tasks) tasks,
    (select count(*)::int from processed_events) markers`);
  expect(result).toEqual({ receipts: 1, stock: 10, movements: 1, tasks: 1, markers: 1 });
  expect(performance.now() - started).toBeLessThan(60000);
});
