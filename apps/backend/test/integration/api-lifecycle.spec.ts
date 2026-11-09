/** @file Production API probes/DB dependency и запрет новых запросов при drain без обхода warehouse policy. */
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { useDatabaseSuite } from '../support/database-harness';
import { DatabaseService } from '@backend/infrastructure/database/database.module';
import { ProcessHealth } from '@backend/infrastructure/lifecycle/process-health';
const database = useDatabaseSuite();
test('AC-304-01/02: API readiness fails on pool loss and drain; liveness stays independent', async () => {
  const app = await database().createHttpApplication();
  const server = app.getHttpServer();
  for (const probe of ['startup', 'ready', 'live'])
    await request(server)
      .get('/health/' + probe)
      .expect(200);
  await request(server).get('/api/v1/warehouses').expect(401);
  await app.get(DatabaseService).onModuleDestroy();
  await request(server).get('/health/ready').expect(503);
  await request(server).get('/health/live').expect(200);
  await request(server).get('/health/startup').expect(200);
  app.get(ProcessHealth).draining = true;
  const correlationId = randomUUID();
  const denied = await request(server)
    .post('/api/v1/receipts')
    .set('X-Correlation-Id', correlationId)
    .send({})
    .expect(503)
    .expect('Content-Type', /application\/problem\+json/);
  expect(denied.body).toMatchObject({
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    type: 'urn:warehouse:problem:service-unavailable',
    instance: '/api/v1/receipts',
    correlationId,
  });
  expect(denied.headers['x-correlation-id']).toBe(correlationId);
  expect(
    (await database().connection.pool.query('select count(*) from http_idempotency')).rows[0].count,
  ).toBe('0');
  await request(server).get('/health/live').expect(200);
});

test('AC-304-02: real API process drains an active response before resource cleanup', async () => {
  const { fork } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const child = fork(resolve('.test-dist/test/support/api-process.fixture.js'), [], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: database().config.databaseUrl,
      AUTH_ORIGIN: 'http://127.0.0.1:3000',
      AUTH_SESSION_ABSOLUTE_SECONDS: '600',
      AUTH_SESSION_IDLE_SECONDS: '300',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let exited = false;
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('exit', (code) => {
      exited = true;
      resolve(code);
    });
    child.once('error', reject);
  });
  const bound = new Promise<number>((resolve) =>
    child.on('message', (message) => {
      if (
        message &&
        typeof message === 'object' &&
        'port' in message &&
        typeof message.port === 'number'
      )
        resolve(message.port);
    }),
  );
  const handling = new Promise<void>((resolve) =>
    child.on('message', (message) => {
      if (message === 'handling') resolve();
    }),
  );
  let response: Promise<number> | undefined;
  try {
    const port = await bound;
    response = fetch(`http://127.0.0.1:${port}/test-hold`).then(
      (r) => r.status,
      () => -1,
    );
    await handling;
    child.kill('SIGTERM');
    // Signal должен обработаться при активном response. Закрытие listener наблюдаем фактическим отказом/503.
    const deadline = Date.now() + 5000;
    let refused = false;
    while (Date.now() < deadline) {
      try {
        refused = (await fetch(`http://127.0.0.1:${port}/health/ready`)).status === 503;
      } catch {
        refused = true;
      }
      if (refused) break;
    }
    expect(refused).toBe(true);
    expect(exited).toBe(false);
    child.send('release');
    expect(await response).toBe(200);
    expect(await closed).toBe(0);
  } finally {
    if (!exited) child.kill('SIGKILL');
    await closed;
    await response?.catch(() => {});
  }
});
