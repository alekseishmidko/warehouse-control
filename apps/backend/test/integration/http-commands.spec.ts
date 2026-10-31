/** @file WMS-107: реальные HTTP/DB idempotency races, rollback, client timeout, isolation и safe errors. */
import { identityFixture, withIdentity, TestIdentity } from '../support/identity.fixture';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { useDatabaseSuite } from '../support/database-harness';
import { waitForDatabaseLock } from '../support/database-lock';
import { CommandProbe, ProbeCommandController } from '../support/http-command.fixture';
import { validateEnvironment } from '@backend/infrastructure/config/environment';
import { IdempotencyModule } from '@backend/infrastructure/idempotency/idempotency.module';
import { AuditModule } from '@backend/modules/audit/audit.module';
import { OutboxModule } from '@backend/infrastructure/outbox/outbox.module';
import { httpIdempotency } from '@backend/infrastructure/idempotency/idempotency.schema';
import { applicationMetadata } from '@backend/infrastructure/database/schema';
import { auditEntries } from '@backend/modules/audit/audit.schema';
import { outboxEvents } from '@backend/infrastructure/outbox/outbox.schema';
import { createOpenApiDocument } from '@backend/infrastructure/http/openapi';
import { HttpCommandsService } from '@backend/infrastructure/idempotency/services/http-commands.service';

const database = useDatabaseSuite();
const actorId = randomUUID();
let actor: TestIdentity;
let app: INestApplication;
let probe: CommandProbe;
/** Config override локален suite: process.env/dev Compose не меняются. */
function config() {
  return validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: database().config.databaseUrl,
    HTTP_HOST: '127.0.0.1',
  });
}
const controllers = [ProbeCommandController];
const imports = [IdempotencyModule, AuditModule, OutboxModule];
beforeAll(async () => {
  app = await database().createHttpApplication({
    config: config(),
    controllers,
    imports,
    providers: [CommandProbe],
  });
  // Постоянный listener нужен для timeout/retry: Supertest не должен закрывать временный server после abort.
  await app.listen(0, '127.0.0.1');
  probe = app.get(CommandProbe);
});
beforeEach(async () => {
  actor = await identityFixture(app, { userId: actorId });
  probe.calls = 0;
  probe.fail = false;
  probe.wait = undefined;
  probe.started = undefined;
});
const body = { name: 'Demo', quantity: 2 };
/** Отправляет настоящий POST; helper не повторяет normalization/hash/business rules. */
const post = (key: string = randomUUID(), payload: unknown = body) =>
  withIdentity(request(app.getHttpServer()).post('/api/v1/commands'), actor)
    .set('Idempotency-Key', key)
    .send(payload as object);

test('normalized repeat returns original status/body/Location and current request correlationId without effects', async () => {
  const key = randomUUID();
  const correlationId = randomUUID();
  const first = await post(key, { quantity: 2, name: ' Demo ' }).expect(201);
  // Correlation меняется между попытками, actor spoof header игнорируется: scope/hash остаются прежними.
  const second = await post(key)
    .set('X-Correlation-Id', correlationId)
    .set('X-Actor-Id', randomUUID())
    .expect(201);
  expect(second.body).toEqual(first.body);
  expect(second.headers.location).toBe(first.headers.location);
  expect(second.headers['x-correlation-id']).toBe(correlationId);
  expect(probe.calls).toBe(1);
  const { db } = database().connection;
  expect(await db.select().from(applicationMetadata)).toHaveLength(1);
  expect(await db.select().from(auditEntries)).toEqual([expect.objectContaining({ actorId })]);
  expect(await db.select().from(outboxEvents)).toHaveLength(1);
  expect(await db.select().from(httpIdempotency)).toEqual([
    expect.objectContaining({ actorId, statusCode: 201, completedAt: expect.any(Date) }),
  ]);
});

test('same key and changed payload returns 409 problem without repeating callback', async () => {
  const key = randomUUID();
  await post(key).expect(201);
  const result = await post(key, { ...body, quantity: 3 })
    .expect(409)
    .expect('Content-Type', /application\/problem\+json/);
  expect(result.body.code).toBe('IDEMPOTENCY_CONFLICT');
  expect(probe.calls).toBe(1);
});

test('concurrent equal keys execute callback once and return the same response', async () => {
  // Удерживаем первую transaction до наблюдаемого unique lock второй; после commit
  // waiter обязан прочитать result отдельным statement и не выполнить свой callback.
  const key = randomUUID();
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  probe.started = ready;
  probe.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = post(key)
    .expect(201)
    .then((response) => response);
  let second: Promise<request.Response> | undefined;
  try {
    await started;
    second = post(key)
      .expect(201)
      .then((response) => response);
    await waitForDatabaseLock(database(), 'http_idempotency');
    release();
    expect((await second).body).toEqual((await first).body);
    expect(probe.calls).toBe(1);
  } finally {
    release();
    await first;
    if (second) await second.catch(() => undefined);
  }
});

test('concurrent same key with different payload has one winner and one conflict', async () => {
  const key = randomUUID();
  const results = await Promise.all([post(key), post(key, { ...body, quantity: 3 })]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(probe.calls).toBe(1);
});

test('callback failure rolls back idempotency, business, audit and outbox; retry is new successful execution', async () => {
  // Probe бросает после реальных INSERT: отсутствие строк подтверждает общий rollback, не раннюю validation.
  const key = randomUUID();
  probe.fail = true;
  const failed = await post(key).expect(500);
  expect(JSON.stringify(failed.body)).not.toContain('private-driver-secret');
  for (const table of [httpIdempotency, applicationMetadata, auditEntries, outboxEvents])
    expect(await database().connection.db.select().from(table)).toEqual([]);
  probe.fail = false;
  await post(key).expect(201);
  expect(probe.calls).toBe(2);
});

test('a concurrent waiter takes over after first request rolls back', async () => {
  // Здесь первый owner откатывается, поэтому ожидающий INSERT должен сам создать pending claim.
  const key = randomUUID();
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  probe.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  probe.started = ready;
  probe.fail = true;
  const first = post(key)
    .expect(500)
    .then((response) => response);
  let second: Promise<request.Response> | undefined;
  try {
    await started;
    second = post(key)
      .expect(201)
      .then((response) => response);
    await waitForDatabaseLock(database(), 'http_idempotency');
    // Первая транзакция видит fail=true; waiter после rollback выполнится с обновлённым флагом.
    release();
    await first;
    probe.fail = false;
    await second;
    expect(probe.calls).toBe(2);
    expect(await database().connection.db.select().from(httpIdempotency)).toHaveLength(1);
  } finally {
    release();
    await first;
    if (second) await second.catch(() => undefined);
  }
});

test('client network timeout does not cancel DB commit; same key retry returns saved result once', async () => {
  // Клиент получает настоящий deadline, пока callback удерживается barrier.
  // Release разрешает серверу commit после ухода клиента; retry проверяет устойчивость сохранённого result.
  const key = randomUUID();
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  probe.started = ready;
  probe.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = post(key)
    .timeout({ deadline: 1000 })
    .then(
      () => undefined,
      (error) => error,
    );
  try {
    await Promise.race([
      started,
      first.then(() => {
        throw new Error('Request failed before business callback');
      }),
    ]);
    expect(await first).toMatchObject({ timeout: 1000 });
    release();
    const retried = await post(key).expect(201);
    expect(retried.body).toMatchObject(body);
    expect(probe.calls).toBe(1);
    expect(await database().connection.db.select().from(httpIdempotency)).toHaveLength(1);
  } finally {
    release();
    await first;
  }
});

test.each([
  { name: 'Demo', quantity: '2' },
  { name: 'Demo', quantity: 0 },
  { ...body, actorId: randomUUID() },
  {},
])('DTO rejects invalid/unknown fields without coercion: %j', async (payload) => {
  await post(randomUUID(), payload).expect(400);
  expect(probe.calls).toBe(0);
});

test('key/header/correlation validation, malformed JSON and safe unknown-route problems', async () => {
  await withIdentity(request(app.getHttpServer()).post('/api/v1/commands'), actor)
    .send(body)
    .expect(400)
    .expect((response) => expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED'));
  await post('bad-key').expect(400);
  await post()
    .set('X-Correlation-Id', 'private-secret')
    .expect(400)
    .expect((response) => expect(JSON.stringify(response.body)).not.toContain('private-secret'));
  await request(app.getHttpServer())
    .post('/api/v1/commands')
    .set('Content-Type', 'application/json')
    .set('Idempotency-Key', randomUUID())
    .send('{"secret":')
    .expect(400);
  const missing = await request(app.getHttpServer())
    .get('/missing?password=private-secret')
    .expect(404);
  expect(missing.body.instance).toBe('/missing');
  expect(JSON.stringify(missing.body)).not.toContain('private-secret');
  await request(app.getHttpServer())
    .post('/api/v1/commands')
    .set('Forwarded', 'for=127.0.0.1')
    .set('X-Actor-Id', actorId)
    .send(body)
    .expect(401);
  expect(probe.calls).toBe(0);
});

test('oversized JSON is 413 before callback and does not echo body contents', async () => {
  const result = await post(randomUUID(), {
    name: 'private-secret'.repeat(30000),
    quantity: 2,
  }).expect(413);
  expect(result.body.code).toBe('REQUEST_TOO_LARGE');
  expect(JSON.stringify(result.body)).not.toContain('private-secret');
  expect(probe.calls).toBe(0);
});

test.each(['disabled', 'production', 'public-bind'])(
  'session required without dev actor for %s',
  async (scenario) => {
    // Намеренно обходим config parser повреждённым DI override: guard должен независимо отказать.
    const override = {
      ...config(),
      ...(scenario === 'disabled'
        ? {}
        : scenario === 'production'
          ? { nodeEnv: 'production' as const }
          : { httpHost: '0.0.0.0' }),
    };
    const other = await database().createHttpApplication({
      config: override,
      controllers,
      imports,
      providers: [CommandProbe],
    });
    try {
      await request(other.getHttpServer())
        .post('/api/v1/commands')
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(401);
      await request(other.getHttpServer()).get('/health').expect(200);
    } finally {
      await other.close();
    }
  },
);

test('actor and operation scopes are independent; runtime can execute but cannot change/delete saved response', async () => {
  const key = randomUUID();
  await post(key).expect(201);
  const commands = app.get(HttpCommandsService);
  for (const scope of [
    { actorId: randomUUID(), operation: 'test.create' },
    { actorId, operation: 'test.other' },
  ]) {
    await commands.execute(
      { ...scope, actorType: 'user', key, correlationId: randomUUID() },
      {},
      async () => ({ statusCode: 200, body: { done: true } }),
    );
  }
  expect(await database().connection.db.select().from(httpIdempotency)).toHaveLength(3);
  const { pool } = database().connection;
  await expect(pool.query("update http_idempotency set body='{}'::jsonb")).rejects.toMatchObject({
    code: '42501',
  });
  await expect(pool.query('delete from http_idempotency')).rejects.toMatchObject({ code: '42501' });
});

test('normalized target participates in hash; JSON null result is replayable; invalid result rolls back', async () => {
  // target — часть нормализованного запроса: другой документ не должен получить cached result первого.
  const commands = app.get(HttpCommandsService);
  const scope = {
    actorType: 'user' as const,
    actorId,
    operation: 'test.target',
    key: randomUUID(),
    correlationId: randomUUID(),
  };
  const target = { receiptId: randomUUID() };
  const callback = jest.fn(async () => ({ statusCode: 200 as const, body: null }));
  const first = await commands.execute(scope, { target }, callback);
  expect(await commands.execute(scope, { target }, callback)).toEqual(first);
  expect(callback).toHaveBeenCalledTimes(1);
  await expect(
    commands.execute(scope, { target: { receiptId: randomUUID() } }, callback),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const invalidScope = { ...scope, key: randomUUID() };
  await expect(
    commands.execute(invalidScope, {}, async () => ({ statusCode: 200, body: undefined })),
  ).rejects.toThrow('Invalid command result');
  expect(await database().connection.db.select().from(httpIdempotency)).toHaveLength(1);
});

test('warehouse_app can claim and complete response, but cannot overwrite completed data', async () => {
  // Один borrowed pg client сохраняет SET LOCAL ROLE только до rollback; host/dev roles не меняются.
  const client = await database().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role warehouse_app');
    await client.query(
      "insert into http_idempotency(actor_type,actor_id,operation,key,request_hash) values('user',$1,'test.role',$2,$3)",
      [actorId, randomUUID(), 'a'.repeat(64)],
    );
    await client.query(
      "update http_idempotency set status_code=200,body='null'::jsonb,headers='{}'::jsonb,completed_at=now()",
    );
    await expect(
      client.query("update http_idempotency set body='{}'::jsonb"),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await client.query('rollback');
    client.release();
  }
});

test('production OpenAPI includes only actual routes, technical exclusions and Problem/header schemas', async () => {
  // Второе приложение создаётся без fixture controllers, как production generation graph.
  const plain = await database().createHttpApplication();
  try {
    const document = createOpenApiDocument(plain);
    expect(Object.keys(document.paths).sort()).toEqual([
      '/',
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/identity/users',
      '/api/v1/identity/users/{userId}',
      '/api/v1/identity/users/{userId}/sessions',
      '/api/v1/identity/users/{userId}/sessions/{sessionId}',
      '/api/v1/identity/users/{userId}/warehouses/{warehouseId}/roles',
      '/api/v1/orders',
      '/api/v1/orders/{orderId}',
      '/api/v1/orders/{orderId}/allocations/{allocationId}/release',
      '/api/v1/orders/{orderId}/cancel',
      '/api/v1/orders/{orderId}/confirm',
      '/api/v1/orders/{orderId}/reserve',
      '/api/v1/putaway-tasks/{taskId}',
      '/api/v1/putaway-tasks/{taskId}/execute',
      '/api/v1/receipts',
      '/api/v1/receipts/{receiptId}',
      '/api/v1/receipts/{receiptId}/post',
      '/health',
    ]);
    expect(document.components?.schemas?.Problem).toBeDefined();
    expect(document.paths['/health'].get?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'X-Correlation-Id' })]),
    );
    await request(plain.getHttpServer()).get('/api/v1/health').expect(404);
  } finally {
    await plain.close();
  }
});
