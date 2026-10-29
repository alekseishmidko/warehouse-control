/** @file WMS-110 реальные production handler/DB: tasks, audit/marker atomicity, unique race и stock invariance. */
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { waitForDatabaseLock } from '../support/database-lock';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { WorkerRepository } from '@backend/infrastructure/worker/repositories/worker.repository';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import { PutawayRepository } from '@backend/modules/inventory/repositories/putaway.repository';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { HandlerRegistry } from '@backend/infrastructure/worker/services/handler-registry';
import {
  ReceivingPostedHandler,
  PUTAWAY_SYSTEM_ACTOR_ID,
} from '@backend/infrastructure/worker/services/receiving-posted.handler';
import { validateWorkerEnvironment } from '@backend/infrastructure/worker/worker.config';
import type { KnownEvent } from '@backend/shared/events/dto/event.dto';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';

const database = useDatabaseSuite();
let api: INestApplication;
let app: INestApplicationContext;
let worker: WorkerService;
beforeAll(async () => {
  api = await database().createHttpApplication();
  app = await database().createWorkerApplication();
  worker = app.get(WorkerService);
});
/** Production fact из immutable DB envelope, не реконструируется вручную из входного DTO. */
async function event(id: string): Promise<KnownEvent> {
  return (
    await database().connection.pool.query('select envelope from outbox_events where event_id=$1', [
      id,
    ])
  ).rows[0].envelope;
}
/** DB evidence: изменение stock или лишний audit/marker видны вместе с созданием task. */
async function state() {
  return (
    await database().connection.pool.query(`select
    (select count(*)::int from putaway_tasks) tasks,
    (select count(*)::int from audit_entries where entity_type='putaway-task') audit,
    (select count(*)::int from processed_events) markers,
    (select coalesce(sum(last_completed_version),0)::int from delivery_streams) delivery,
    (select coalesce(sum(last_processed_version),0)::int from consumer_streams) consumer,
    (select count(*)::int from stock_movements) movements,
    (select coalesce(sum(on_hand),0)::int from stock_balances) stock,
    (select coalesce(sum(reserved),0)::int from stock_balances) reserved,
    (select count(*)::int from outbox_events) events`)
  ).rows[0];
}
/** Awaited consumer entry: это настоящая registered production реализация, не test no-op. */
async function processNext() {
  const [claim] = await worker.claim();
  expect(claim).toBeDefined();
  return worker.process(claim);
}
/** Метаданные прямого внутреннего API для проверки его idempotency/SQL constraints. */
function input(fact: KnownEvent) {
  return {
    event: fact,
    actorType: 'system' as const,
    actorId: PUTAWAY_SYSTEM_ACTOR_ID,
    correlationId: fact.correlationId,
    reasonCode: 'receipt-posted',
  };
}

test('registered handler creates one pending task, same stock 10/movement/event, atomic marker/cursors and audit provenance', async () => {
  const { document } = await postedReceiptFixture(api);
  expect(app.get(HandlerRegistry).destinations()).toEqual(['inventory.putaway']);
  expect((await state()).tasks).toBe(0);
  expect(await processNext()).toBe('completed');
  expect(await state()).toEqual({
    tasks: 1,
    audit: 1,
    markers: 1,
    delivery: 1,
    consumer: 1,
    movements: 1,
    stock: 10,
    reserved: 0,
    events: 1,
  });
  const rows = (
    await database().connection.pool
      .query(`select t.*,a.actor_type,a.actor_id,a.correlation_id,a.action
    from putaway_tasks t join audit_entries a on a.id=t.audit_id`)
  ).rows;
  const fact = await event(document.postedEventId!);
  expect(rows[0]).toMatchObject({
    source_receipt_id: document.id,
    source_receipt_line_id: document.lines[0].id,
    source_event_id: document.postedEventId,
    quantity: 10,
    status: 'pending',
    source_location_id: document.receivingLocationId,
    actor_type: 'system',
    actor_id: PUTAWAY_SYSTEM_ACTOR_ID,
    correlation_id: fact.correlationId,
    action: 'inventory.putaway-task-created',
  });
  // Выполняем документированный read-only SQL proof с server UUID, не произвольной строкой клиента.
  expect(document.id).toMatch(/^[0-9a-f-]{36}$/);
  await database().connection.pool.query(
    readFileSync(resolve('../../docs/examples/putaway-result.sql'), 'utf8').replaceAll(
      ":'receipt_id'",
      `'${document.id}'`,
    ),
  );
});

test('duplicate delivery, public inventory repeat and controlled marker replay leave one task/audit and unchanged stock', async () => {
  const { document } = await postedReceiptFixture(api);
  const [claim] = await worker.claim();
  await worker.process(claim);
  expect(await worker.process(claim)).toBe('stale');
  const fact = await event(document.postedEventId!);
  await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((context) => api.get(InventoryService).createPutawayTasks(context, input(fact)));
  // Test-only transport reset сохраняет consumer marker/cursor/task; recovery CLI пока нет.
  await database().connection.pool.query(
    "update outbox_deliveries set status='pending',completed_at=null",
  );
  await database().connection.pool.query('update delivery_streams set last_completed_version=0');
  expect(await processNext()).toBe('completed');
  expect(await state()).toEqual({
    tasks: 1,
    audit: 1,
    markers: 1,
    delivery: 1,
    consumer: 1,
    movements: 1,
    stock: 10,
    reserved: 0,
    events: 1,
  });
});

test('two workers with same token wait on actual locks; one business effect survives', async () => {
  await postedReceiptFixture(api);
  const other = await database().createWorkerApplication();
  const [claim] = await worker.claim();
  const inventory = app.get(InventoryService);
  const original = inventory.createPutawayTasks.bind(inventory);
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = jest.spyOn(inventory, 'createPutawayTasks').mockImplementation(async (...args) => {
    const tasks = await original(...args);
    entered();
    await barrier;
    return tasks;
  });
  const first = worker.process(claim);
  let second: ReturnType<WorkerService['process']> | undefined;
  try {
    await Promise.race([
      started,
      first.then(() => {
        throw new Error('Exited before barrier');
      }),
    ]);
    expect((await state()).tasks).toBe(0); // Task/audit ещё uncommitted в первом worker.
    second = other.get(WorkerService).process(claim);
    await waitForDatabaseLock(database(), 'delivery_streams');
    release();
    expect(await Promise.all([first, second])).toEqual(['completed', 'stale']);
    expect((await state()).tasks).toBe(1);
    expect((await state()).stock).toBe(10);
  } finally {
    release();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    spy.mockRestore();
    await other.close();
  }
});

test('concurrent direct inventory calls race on absent source line, unique constraint rolls back loser audit', async () => {
  const { document } = await postedReceiptFixture(api);
  const fact = await event(document.postedEventId!);
  const repository = api.get(PutawayRepository);
  const original = repository.findBySourceLine.bind(repository);
  let count = 0;
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = jest.spyOn(repository, 'findBySourceLine').mockImplementation(async (...args) => {
    const row = await original(...args);
    if (++count === 2) entered();
    await barrier;
    return row;
  });
  const calls = [1, 2].map(() =>
    api
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((context) => api.get(InventoryService).createPutawayTasks(context, input(fact))),
  );
  try {
    await Promise.race([
      started,
      Promise.allSettled(calls).then(() => {
        throw new Error('Calls ended before race');
      }),
    ]);
    release();
    const results = await Promise.allSettled(calls);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await state()).tasks).toBe(1);
    expect((await state()).audit).toBe(1);
    expect((await state()).stock).toBe(10);
    // Direct call не пишет marker: worker затем узнает идентичную task и завершит доставку.
    expect(await processNext()).toBe('completed');
    expect((await state()).audit).toBe(1);
  } finally {
    release();
    await Promise.allSettled(calls);
    spy.mockRestore();
  }
});

test.each([
  'audit_entries',
  'putaway_tasks',
  'processed_events',
  'consumer_streams',
  'outbox_deliveries',
  'delivery_streams',
])(
  'failure after %s rolls back tasks/audit/marker/ack and retry keeps same source and stock',
  async (table) => {
    await postedReceiptFixture(api);
    const [claim] = await worker.claim();
    const pool = database().connection.pool;
    const operation = ['audit_entries', 'putaway_tasks', 'processed_events'].includes(table)
      ? 'insert'
      : 'update';
    const condition =
      table === 'audit_entries'
        ? "when (new.entity_type='putaway-task')"
        : table === 'outbox_deliveries'
          ? "when (new.status='completed')"
          : table === 'delivery_streams'
            ? 'when (new.last_completed_version>0)'
            : '';
    await pool.query(
      "create function putaway_fault() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$",
    );
    try {
      await pool.query(
        `create trigger putaway_fault after ${operation} on ${table} for each row ${condition} execute function putaway_fault()`,
      );
      try {
        expect(await worker.process(claim)).toBe('retry');
        expect(await state()).toEqual({
          tasks: 0,
          audit: 0,
          markers: 0,
          delivery: 0,
          consumer: 0,
          movements: 1,
          stock: 10,
          reserved: 0,
          events: 1,
        });
      } finally {
        await pool.query(`drop trigger putaway_fault on ${table}`);
      }
    } finally {
      await pool.query('drop function putaway_fault()');
    }
    await pool.query(
      "update outbox_deliveries set available_at=clock_timestamp()-interval '1 second'",
    );
    expect(await processNext()).toBe('completed');
    expect((await state()).tasks).toBe(1);
    expect((await state()).stock).toBe(10);
  },
);

test('failure after second line task cancels entire document task batch, then retry creates both', async () => {
  await postedReceiptFixture(api, 10, 2);
  const repository = app.get(PutawayRepository);
  const original = repository.insert.bind(repository);
  let calls = 0;
  // Fault после настоящих audit/task INSERT обеих строк; stock поступил ранее и сохраняется 20.
  const spy = jest.spyOn(repository, 'insert').mockImplementation(async (...args) => {
    const row = await original(...args);
    if (++calls === 2) throw new Error('fault second task');
    return row;
  });
  try {
    expect(await processNext()).toBe('retry');
    expect((await state()).tasks).toBe(0);
    expect((await state()).audit).toBe(0);
  } finally {
    spy.mockRestore();
  }
  await database().connection.pool.query(
    "update outbox_deliveries set available_at=clock_timestamp()-interval '1 second'",
  );
  expect(await processNext()).toBe('completed');
  expect((await state()).tasks).toBe(2);
  expect((await state()).stock).toBe(20);
  expect((await state()).movements).toBe(2);
});

test('semantic duplicate/aggregate conflict and mismatched quantity/source event never create partial task', async () => {
  const { document } = await postedReceiptFixture(api);
  const fact = await event(document.postedEventId!);
  const service = api.get(InventoryService);
  const variants = [
    { ...fact, aggregateId: randomUUID() },
    {
      ...fact,
      payload: { ...fact.payload, lines: [...fact.payload.lines, ...fact.payload.lines] },
    },
    {
      ...fact,
      payload: {
        ...fact.payload,
        lines: fact.payload.lines.map((line) => ({ ...line, quantity: line.quantity + 1 })),
      },
    },
    { ...fact, eventId: randomUUID() },
  ];
  for (const value of variants) {
    await expect(
      api
        .get<TransactionRunner>(TRANSACTION_RUNNER)
        .run((context) => service.createPutawayTasks(context, input(value as KnownEvent))),
    ).rejects.toThrow();
    expect((await state()).tasks).toBe(0);
    expect((await state()).audit).toBe(0);
  }
  expect(await processNext()).toBe('completed');
  await expect(
    api
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run((context) =>
        service.createPutawayTasks(context, input({ ...fact, eventId: randomUUID() })),
      ),
  ).rejects.toThrow();
  expect((await state()).tasks).toBe(1);
  expect((await state()).audit).toBe(1);
});

test('runtime warehouse_app can handle source FKs/audit and tasks remain immutable', async () => {
  await postedReceiptFixture(api);
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const restrictedRunner: TransactionRunner = {
    run: (work) =>
      runner.run(async (context) => {
        await transactionClient(context).execute(sql`set local role warehouse_app`);
        return work(context);
      }),
  };
  const restricted = new WorkerService(
    restrictedRunner,
    app.get(WorkerRepository),
    app.get(HandlerRegistry),
    validateWorkerEnvironment({}),
  );
  const [claim] = await restricted.claim();
  expect(await restricted.process(claim)).toBe('completed');
  for (const query of [
    'update putaway_tasks set quantity=11',
    'delete from putaway_tasks',
    'truncate putaway_tasks',
  ]) {
    await expect(database().connection.pool.query(query)).rejects.toMatchObject({ code: '42501' });
  }
  expect((await state()).tasks).toBe(1);
  expect((await state()).stock).toBe(10);
});

test('new fact for an already scheduled source line is dead, rather than silently creating or acknowledging another task', async () => {
  const { document } = await postedReceiptFixture(api);
  expect(await processNext()).toBe('completed');
  const { eventId, aggregateVersion, ...duplicateFact } = await event(document.postedEventId!);
  // Test-only malformed business fact: append API остаётся настоящим, HTTP posting такое не производит.
  await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((context) => api.get(OutboxService).append(context, duplicateFact));
  expect(await processNext()).toBe('dead');
  expect((await state()).tasks).toBe(1);
  expect((await state()).audit).toBe(1);
  expect((await state()).stock).toBe(10);
  expect((await state()).consumer).toBe(1);
  expect((await state()).delivery).toBe(1);
  expect(
    (
      await database().connection.pool.query(
        "select last_error from outbox_deliveries where status='dead'",
      )
    ).rows,
  ).toEqual([{ last_error: 'HANDLER_REJECTED' }]);
});
