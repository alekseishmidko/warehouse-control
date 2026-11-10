/** @file WMS-401: настоящий HTTP/SQL/outbox/handler, trace links, replay и rollback без утечки данных. */
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { identityFixture, withIdentity } from '../support/identity.fixture';
import { startTelemetry, stopTelemetry } from '@backend/infrastructure/logging/telemetry';
import { configureLogging, stopLogging } from '@backend/infrastructure/logging/runtime-logger';
import { createDatabaseConnection } from '@backend/infrastructure/database/connection';
import { sql } from 'drizzle-orm';
import { outboxFixture } from '../support/outbox.fixture';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import {
  transactionClient,
  PostgresTransactionRunner,
} from '@backend/infrastructure/database/postgres-transaction-runner';
import { logScope } from '@backend/infrastructure/logging/runtime-logger';
import { validateWorkerEnvironment } from '@backend/infrastructure/worker/worker.config';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
const db = useDatabaseSuite();
const exporter = new InMemorySpanExporter();
const lines: string[] = [];
let app: INestApplication, worker: INestApplicationContext;
beforeAll(async () => {
  startTelemetry('api', 'test', [new SimpleSpanProcessor({ exporter })]);
  configureLogging(
    { process: 'api', environment: 'test', module: 'http' },
    {
      write(line: string) {
        lines.push(line);
      },
    },
  );
  app = await db().createHttpApplication();
  worker = await db().createWorkerApplication();
});
afterAll(async () => {
  await stopTelemetry();
  await stopLogging();
});
/** Разбор каждой строки обязателен: нельзя отфильтровать не-JSON вывод и назвать схему пройденной. */
function records() {
  return lines.map((line) => {
    expect(line.endsWith('\n')).toBe(true);
    const r = JSON.parse(line) as Record<string, unknown>;
    for (const field of [
      'timestamp',
      'level',
      'service',
      'environment',
      'process',
      'module',
      'event',
      'message',
    ])
      expect(typeof r[field]).toBe('string');
    return r;
  });
}
test('AC-401-03/04: HTTP posting → committed outbox → linked handler; replay and failure have no false success', async () => {
  const x = await postedReceiptFixture(app);
  const actor = await identityFixture(app, { warehouseId: x.fixture.warehouse.id });
  const created = await withIdentity(request(app.getHttpServer()).post('/api/v1/receipts'), actor)
    .set('Idempotency-Key', randomUUID())
    .send({
      warehouseId: x.fixture.warehouse.id,
      receivingLocationId: x.fixture.receiving.id,
      lines: [{ productId: x.fixture.product.id, quantity: 2 }],
    })
    .expect(201);
  const id = String(created.body.id),
    correlationId = randomUUID(),
    key = randomUUID();
  const send = () =>
    withIdentity(request(app.getHttpServer()).post(`/api/v1/receipts/${id}/post`), actor)
      .set('Idempotency-Key', key)
      .set('X-Correlation-Id', correlationId)
      .set('traceparent', '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01')
      .set('Authorization', 'SECRET_HEADER')
      .send({});
  await send().expect(200);
  await send().expect(200);
  const event = (
    await db().connection.pool.query('select envelope from outbox_events where aggregate_id=$1', [
      id,
    ])
  ).rows[0].envelope as { traceparent: string; eventId: string };
  expect(event.traceparent).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[a-f0-9]{16}-01$/);
  for (const claim of await worker.get(WorkerService).claim())
    await worker.get(WorkerService).process(claim);
  const own = records().filter((r) => r.correlationId === correlationId);
  expect(own.filter((r) => r.event === 'receiving.posted')).toHaveLength(1);
  expect(own.some((r) => r.event === 'operation.replayed')).toBe(true);
  expect(own.some((r) => r.event === 'delivery.completed' && r.eventId === event.eventId)).toBe(
    true,
  );
  const spans = exporter.getFinishedSpans();
  // Контракт privacy проверяет также состав instrumentation: ORM/driver не должны незаметно экспортировать SQL/params.
  expect(spans.every((span) => span.instrumentationScope.name === 'warehouse')).toBe(true);
  const handler = spans.find(
    (s) => s.name === 'handler' && s.links.some((l) => l.context.traceId === 'a'.repeat(32)),
  );
  expect(handler).toBeDefined();
  expect(handler!.spanContext().traceId).not.toBe('a'.repeat(32));
  expect(handler!.links[0].context.spanId).toBe(event.traceparent.split('-')[2]);
  const snapshot = lines.join('') + JSON.stringify(spans.map((s) => s.attributes));
  expect(snapshot).not.toMatch(/SECRET_HEADER|password|authorization|cookie|payload|db.statement/i);
  // Настоящие SQL effects выполнены, затем fault откатывает весь COMMIT; success из буфера исчезает.
  const next = await withIdentity(request(app.getHttpServer()).post('/api/v1/receipts'), actor)
    .set('Idempotency-Key', randomUUID())
    .send({
      warehouseId: x.fixture.warehouse.id,
      receivingLocationId: x.fixture.receiving.id,
      lines: [{ productId: x.fixture.product.id, quantity: 1 }],
    })
    .expect(201);
  const badCorrelation = randomUUID();
  await db().connection.pool.query(
    `create function public.wms401_commit_failure() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE_COMMIT_SECRET'; end $$`,
  );
  await db().connection.pool.query(
    `create constraint trigger wms401_commit_failure after update on receipts deferrable initially deferred for each row execute function public.wms401_commit_failure()`,
  );
  try {
    await withIdentity(
      request(app.getHttpServer()).post(`/api/v1/receipts/${String(next.body.id)}/post`),
      actor,
    )
      .set('Idempotency-Key', randomUUID())
      .set('X-Correlation-Id', badCorrelation)
      .send({})
      .expect(500);
  } finally {
    await db().connection.pool.query('drop trigger wms401_commit_failure on receipts');
    await db().connection.pool.query('drop function public.wms401_commit_failure()');
  }
  const failed = records().filter((r) => r.correlationId === badCorrelation);
  expect(failed.some((r) => r.event === 'transaction.failed')).toBe(true);
  expect(
    failed.some((r) => ['receiving.posted', 'operation.completed'].includes(String(r.event))),
  ).toBe(false);
  const rollback = failed.find((r) => r.event === 'transaction.failed');
  expect(rollback?.spanId).toEqual(expect.any(String));
  expect(
    failed.some((r) => r.event === 'transaction.committed' && r.spanId === rollback?.spanId),
  ).toBe(false);
  expect(lines.join('')).not.toContain('PRIVATE_COMMIT_SECRET');
  expect(
    (await db().connection.pool.query('select status from receipts where id=$1', [next.body.id]))
      .rows[0].status,
  ).toBe('draft');
});

test('AC-401-03: concurrent HTTP publications retain their own correlation and trace', async () => {
  const x = await postedReceiptFixture(app);
  const actor = await identityFixture(app, { warehouseId: x.fixture.warehouse.id });
  const pairs = [
    { correlationId: randomUUID(), traceId: 'c'.repeat(32) },
    { correlationId: randomUUID(), traceId: 'd'.repeat(32) },
  ];
  await Promise.all(
    pairs.map(async (pair) => {
      const created = await withIdentity(
        request(app.getHttpServer()).post('/api/v1/receipts'),
        actor,
      )
        .set('Idempotency-Key', randomUUID())
        .send({
          warehouseId: x.fixture.warehouse.id,
          receivingLocationId: x.fixture.receiving.id,
          lines: [{ productId: x.fixture.product.id, quantity: 1 }],
        })
        .expect(201);
      const response = await withIdentity(
        request(app.getHttpServer()).post(`/api/v1/receipts/${String(created.body.id)}/post`),
        actor,
      )
        .set('Idempotency-Key', randomUUID())
        .set('X-Correlation-Id', pair.correlationId)
        .set('traceparent', `00-${pair.traceId}-${'e'.repeat(16)}-01`)
        .send({})
        .expect(200);
      expect(response.headers['x-correlation-id']).toBe(pair.correlationId);
      const event = (
        await db().connection.pool.query(
          'select envelope from outbox_events where aggregate_id=$1',
          [created.body.id],
        )
      ).rows[0].envelope as { traceparent: string; correlationId: string };
      expect(event.correlationId).toBe(pair.correlationId);
      expect(event.traceparent.split('-')[1]).toBe(pair.traceId);
      const posted = records().filter(
        (r) => r.event === 'receiving.posted' && r.aggregateId === created.body.id,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject(pair);
    }),
  );
});

/** Технический handler имитирует временную ошибку после SQL; повтор виден по тому же eventId без payload. */
test('AC-401-03/04: retry and success are linked traces with one committed handler effect', async () => {
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const event = await runner.run((context) =>
    app.get(OutboxService).append(context, outboxFixture()),
  );
  let fail = true;
  const retryWorker = await db().createWorkerApplication(
    [
      {
        destination: 'inventory.putaway',
        async handle(context, input) {
          await transactionClient(context).execute(
            sql`insert into application_metadata(key,value) values(${input.eventId},'one')`,
          );
          if (fail) {
            fail = false;
            throw new Error('PRIVATE_RETRY_ERROR');
          }
        },
      },
    ],
    { ...validateWorkerEnvironment({}), retryBaseMs: 1, retryMaxMs: 1 },
  );
  const service = retryWorker.get(WorkerService);
  const [claim] = await service.claim();
  expect(await service.process(claim)).toBe('retry');
  expect(
    (await db().connection.pool.query('select * from application_metadata')).rows,
  ).toHaveLength(0);
  // Только test clock для disposable БД; не меняет production backoff.
  await db().connection.pool.query(
    "update outbox_deliveries set available_at=clock_timestamp()-interval '1 second'",
  );
  const [again] = await service.claim();
  expect(again.eventId).toBe(claim.eventId);
  // Проекция старого claim может не содержать correlation; envelope и durable effect проверяются прежним владельцем.
  expect(await service.process({ ...again, correlationId: null })).toBe('completed');
  expect(
    (await db().connection.pool.query('select * from application_metadata')).rows,
  ).toHaveLength(1);
  const own = records().filter((r) => r.eventId === event.eventId);
  expect(own).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'delivery.retry',
        attempt: 1,
        errorCode: 'TRANSIENT_FAILURE',
      }),
      expect.objectContaining({ event: 'delivery.completed', attempt: 2 }),
    ]),
  );
  for (const item of own.filter(
    (r) => r.event === 'delivery.retry' || r.event === 'delivery.completed',
  )) {
    const span = exporter.getFinishedSpans().find((s) => s.spanContext().spanId === item.spanId);
    expect(span?.name).toBe('handler');
    expect(span?.status.code).toBe(item.event === 'delivery.retry' ? 2 : 1);
  }
  expect(lines.join('')).not.toContain('PRIVATE_RETRY_ERROR');
});

/** Два независимых соединения и barrier доказывают потерю ACK ROLLBACK без искусственной подмены runner. */
test('AC-401-04: lost rollback acknowledgement is unknown outcome, never confirmed rollback or success', async () => {
  const connection = createDatabaseConnection(db().config.databaseUrl);
  const runner = new PostgresTransactionRunner(connection.db);
  const correlationId = randomUUID();
  let release = () => {};
  let reached = (_pid: number) => {};
  let disconnected = () => {};
  const disconnect = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  connection.pool.on('connect', (client) => {
    client.once('error', disconnected);
  });
  const barrier = new Promise<number>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = logScope({ correlationId }, () =>
    runner.run(async (context) => {
      const result = await transactionClient(context).execute(sql`select pg_backend_pid() as pid`);
      reached(Number(result.rows[0].pid));
      await resume;
      throw new Error('PRIVATE_CALLBACK_FAILURE');
    }),
  ).then(
    () => ({ failed: false }),
    () => ({ failed: true }),
  );
  try {
    const pid = await Promise.race([
      barrier,
      work.then(() => {
        throw new Error('Transaction ended before disconnect barrier');
      }),
    ]);
    await db().connection.pool.query('select pg_terminate_backend($1)', [pid]);
    await disconnect;
  } finally {
    release();
    await work;
    await connection.pool.end();
  }
  expect(await work).toEqual({ failed: true });
  const own = records().filter((r) => r.correlationId === correlationId);
  expect(own.some((r) => r.event === 'transaction.failed')).toBe(true);
  expect(
    own.some((r) => r.event === 'transaction.rolled_back' || r.event === 'transaction.committed'),
  ).toBe(false);
  expect(lines.join('')).not.toContain('PRIVATE_CALLBACK_FAILURE');
  // Pool-level error listener также обязан проглотить raw driver text и оставить безопасный код.
  db().connection.pool.emit('error', new Error('PRIVATE_IDLE_DRIVER_ERROR'));
  expect(records().some((r) => r.event === 'database.connection_failed')).toBe(true);
  expect(lines.join('')).not.toContain('PRIVATE_IDLE_DRIVER_ERROR');
});

/** Socket открывается внутри запроса, но idle pool event принадлежит владельцу pool, а не этому запросу. */
test('AC-401-02: idle PostgreSQL error never inherits the request which first opened its socket', async () => {
  const connection = createDatabaseConnection(db().config.databaseUrl);
  const correlationId = randomUUID();
  const start = lines.length;
  // Listener установлен до kill; callback ошибки должен завершиться до проверки записей.
  const failed = new Promise<void>((resolve) => connection.pool.once('error', () => resolve()));
  try {
    const result = await logScope({ correlationId }, () =>
      connection.pool.query('select pg_backend_pid() as pid'),
    );
    await db().connection.pool.query('select pg_terminate_backend($1)', [result.rows[0].pid]);
    await failed;
    const diagnostics = records()
      .slice(start)
      .filter((r) => r.event === 'database.connection_failed');
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const record of diagnostics) {
      expect(record).not.toHaveProperty('correlationId');
      expect(record).not.toHaveProperty('traceId');
      expect(record).not.toHaveProperty('spanId');
    }
  } finally {
    await connection.pool.end();
  }
});
