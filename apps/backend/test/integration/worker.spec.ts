/** @file WMS-109 PostgreSQL: два worker graphs, real locks, ordering, dedup, faults и lease fencing. */
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { useDatabaseSuite } from '../support/database-harness';
import { outboxFixture } from '../support/outbox.fixture';
import { waitForDatabaseLock } from '../support/database-lock';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { WorkerRepository } from '@backend/infrastructure/worker/repositories/worker.repository';
import { validateWorkerEnvironment, WorkerConfig } from '@backend/infrastructure/worker/worker.config';
import { PermanentDeliveryError } from '@backend/infrastructure/worker/delivery-policy';
import type { LocalEventHandler } from '@backend/infrastructure/worker/dto/delivery.dto';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { TRANSACTION_RUNNER, TransactionRunner, TransactionContext } from '@backend/shared/transactions/transaction.port';
import type { KnownEvent } from '@backend/shared/events/dto/event.dto';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import { AuditService } from '@backend/modules/audit/services/audit.service';

const database = useDatabaseSuite();
let runner: TransactionRunner; let outbox: OutboxService; let audit: AuditService;
const config = { ...validateWorkerEnvironment({}), retryBaseMs: 1, retryMaxMs: 1 };
const contexts: INestApplicationContext[] = [];
beforeAll(async () => { const app = await database().createHttpApplication(); runner = app.get(TRANSACTION_RUNNER); outbox = app.get(OutboxService); audit = app.get(AuditService); });
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

/** Technical effect, не бизнес-handler: каждое повторное применение увеличило бы counter и выдало дубль. */
async function effect(context: TransactionContext, event: KnownEvent): Promise<void> {
  await transactionClient(context).execute(sql`insert into application_metadata(key,value) values(${event.eventId},'1')
    on conflict(key) do update set value=(application_metadata.value::integer+1)::text`);
}
/** Отдельный реальный Nest/pg graph, без listener/изменения env; handler только тестовой disposable БД. */
async function worker(handle: LocalEventHandler['handle'] = effect, settings: WorkerConfig = config) {
  const app = await database().createWorkerApplication([{ destination: 'inventory.putaway', handle }], settings);
  contexts.push(app); return { service: app.get(WorkerService), repository: app.get(WorkerRepository), runner: app.get<TransactionRunner>(TRANSACTION_RUNNER) };
}
/** Writer production генерирует настоящие sequence/event/delivery/stream, fixture не подменяет ORM sync. */
async function events(length = 1, aggregateId = randomUUID()): Promise<KnownEvent[]> {
  return runner.run(async context => {
    const result: KnownEvent[] = [];
    for (let i = 0; i < length; i++) result.push(await outbox.append(context, outboxFixture({ aggregateId })));
    return result;
  });
}
/** Текущий durable protocol state; SQL только read, технические fault mutations поясняются отдельно. */
async function state() {
  return (await database().connection.pool.query(`select (select count(*)::int from application_metadata) effects,
    (select count(*)::int from processed_events) markers,(select coalesce(sum(last_processed_version),0)::int from consumer_streams) consumer,
    (select coalesce(sum(last_completed_version),0)::int from delivery_streams) delivery`)).rows[0];
}
/** Disposable test clock: не ждём реальную lease/retry задержку, обе expiry меняются согласованно. */
async function expire() {
  await database().connection.pool.query("update delivery_streams set lease_until=clock_timestamp()-interval '1 second' where lease_token is not null");
  await database().connection.pool.query("update outbox_deliveries set lease_until=clock_timestamp()-interval '1 second' where lease_token is not null");
}

test('two workers claim different streams and only next version; processing advances both cursors atomically', async () => {
  const a = await worker(effect, { ...config, batchSize: 1 }); const b = await worker(effect, { ...config, batchSize: 1 });
  const first = await events(2); await events(1);
  const [ca, cb] = await Promise.all([a.service.claim(), b.service.claim()]);
  expect(ca).toHaveLength(1); expect(cb).toHaveLength(1); expect(ca[0].aggregateId).not.toBe(cb[0].aggregateId);
  expect([ca[0].version, cb[0].version]).toEqual([1, 1]);
  expect(await a.service.claim()).toEqual([]);
  expect(await Promise.all([a.service.process(ca[0]), b.service.process(cb[0])])).toEqual(['completed', 'completed']);
  const [next] = await a.service.claim(); expect(next.eventId).toBe(first[1].eventId); expect(next.version).toBe(2);
  expect(await a.service.process(next)).toBe('completed');
  expect(await state()).toEqual({ effects: 3, markers: 3, consumer: 3, delivery: 3 });
  expect((await database().connection.pool.query('select distinct value from application_metadata')).rows).toEqual([{ value: '1' }]);
});

test('SKIP LOCKED passes a locked stream and processes independent aggregate', async () => {
  const a = await worker(); const first = await events(); const second = await events();
  const client = await database().connection.pool.connect();
  try {
    await client.query('begin'); await client.query('select 1 from delivery_streams where aggregate_id=$1 for update', [first[0].aggregateId]);
    const claimed = await a.service.claim(); expect(claimed.map(claim => claim.eventId)).toEqual([second[0].eventId]);
    expect(await a.service.process(claimed[0])).toBe('completed');
  } finally { await client.query('rollback'); client.release(); }
});

test('expired claim rotates token; stale worker cannot apply, complete or record failure for new owner', async () => {
  const a = await worker(); const b = await worker(); await events();
  const [old] = await a.service.claim(); await expire();
  expect(await a.service.process(old)).toBe('stale');
  const [current] = await b.service.claim(); expect(current.token).not.toBe(old.token);
  expect(await a.service.process(old)).toBe('stale'); expect(await state()).toEqual({ effects: 0, markers: 0, consumer: 0, delivery: 0 });
  expect(await b.service.process(current)).toBe('completed');
  expect(await a.service.process(current)).toBe('stale'); // crash after commit / lost local acknowledgement
  expect((await state()).effects).toBe(1);
});

test('active processing row locks fence reclaim even after expiry and block only that aggregate', async () => {
  const a = await worker(); const b = await worker(); await events(2);
  const [claim] = await a.service.claim(); await expire();
  // Возвращаем lease всего на 200 ms, затем handler держит обе реальные row locks.
  await database().connection.pool.query("update delivery_streams set lease_until=clock_timestamp()+interval '200 milliseconds'");
  await database().connection.pool.query("update outbox_deliveries set lease_until=clock_timestamp()+interval '200 milliseconds' where status='processing'");
  let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = a.repository.prepareConsumer.bind(a.repository);
  const spy = jest.spyOn(a.repository, 'prepareConsumer').mockImplementation(async (...args) => { const result = await original(...args); entered(); await barrier; return result; });
  const pending = a.service.process(claim);
  try {
    await started;
    // DB clock wait внутри независимого SELECT (не transaction handler), пока удерживаются locks.
    await database().connection.pool.query('select pg_sleep(0.25)');
    const other = await events(); const available = await b.service.claim();
    expect(available.map(value => value.eventId)).toEqual([other[0].eventId]);
    await b.service.process(available[0]); release(); expect(await pending).toBe('completed');
  } finally { release(); await pending; spy.mockRestore(); }
});

test('durable marker prevents effect on controlled redelivery while transport cursor catches up', async () => {
  const a = await worker(); await events(); const [claim] = await a.service.claim(); await a.service.process(claim);
  // Test-only transport replay: сохраняем consumer marker/cursor. Админ CLI ещё не существует.
  await database().connection.pool.query("update outbox_deliveries set status='pending',completed_at=null");
  await database().connection.pool.query('update delivery_streams set last_completed_version=0');
  const [repeat] = await a.service.claim(); expect(await a.service.process(repeat)).toBe('completed');
  expect(await state()).toEqual({ effects: 1, markers: 1, consumer: 1, delivery: 1 });
});

test('two concurrent processors with the same claim recheck state after waiting on row locks', async () => {
  const a = await worker(); const b = await worker(); await events(); const [claim] = await a.service.claim();
  let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  const original = a.repository.prepareConsumer.bind(a.repository);
  // Удерживаем реальные locks первого run; второй обязан ждать PostgreSQL,
  // затем увидеть completed после commit, а не довериться snapshot до ожидания.
  const spy = jest.spyOn(a.repository, 'prepareConsumer').mockImplementation(async (...args) => { const result = await original(...args); entered(); await barrier; return result; });
  const first = a.service.process(claim); let second: ReturnType<WorkerService['process']> | undefined;
  try {
    await Promise.race([started, first.then(() => { throw new Error('Processing exited before barrier'); })]);
    second = b.service.process(claim); await waitForDatabaseLock(database(), 'delivery_streams'); release();
    expect(await Promise.all([first, second])).toEqual(['completed', 'stale']);
    expect(await state()).toEqual({ effects: 1, markers: 1, consumer: 1, delivery: 1 });
  } finally { release(); await Promise.allSettled([first, ...(second ? [second] : [])]); spy.mockRestore(); }
});

test.each(['application_metadata', 'processed_events', 'consumer_streams', 'outbox_deliveries', 'delivery_streams'])(
  'fault after %s rolls back effect/marker/cursors/completion and retries the same event', async table => {
    const a = await worker(); const [event] = await events(); const [claim] = await a.service.claim();
    const operation = ['application_metadata', 'processed_events'].includes(table) ? 'insert' : 'update';
    const when = table === 'outbox_deliveries' ? "when (new.status='completed')" : table === 'delivery_streams' ? 'when (new.last_completed_version>0)' : '';
    const pool = database().connection.pool;
    // AFTER trigger отказывает после настоящей записи; не возвращает fake business response.
    await pool.query("create function worker_fault() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$");
    try {
      await pool.query(`create trigger worker_fault after ${operation} on ${table} for each row ${when} execute function worker_fault()`);
      try {
        expect(await a.service.process(claim)).toBe('retry');
        expect(await state()).toEqual({ effects: 0, markers: 0, consumer: 0, delivery: 0 });
      } finally { await pool.query(`drop trigger worker_fault on ${table}`); }
    } finally { await pool.query('drop function worker_fault()'); }
    await pool.query("update outbox_deliveries set available_at=clock_timestamp()-interval '1 second'");
    const [retry] = await a.service.claim(); expect(retry.eventId).toBe(event.eventId);
    expect(await a.service.process(retry)).toBe('completed'); expect((await state()).effects).toBe(1);
  });

test('permanent rejection is durable dead, blocks next version but independent streams continue', async () => {
  const first = await events(2); const second = await events();
  const a = await worker(async (context, event) => {
    if (event.aggregateId === first[0].aggregateId) throw new PermanentDeliveryError('HANDLER_REJECTED');
    await effect(context, event);
  });
  const claims = await a.service.claim();
  expect(await Promise.all(claims.map(claim => a.service.process(claim)))).toEqual(expect.arrayContaining(['dead', 'completed']));
  expect(await a.service.claim()).toEqual([]);
  const rows = (await database().connection.pool.query('select status,last_error from outbox_deliveries order by status')).rows;
  expect(rows).toEqual(expect.arrayContaining([{ status: 'dead', last_error: 'HANDLER_REJECTED' }, { status: 'pending', last_error: null }]));
  expect((await database().connection.pool.query('select key from application_metadata')).rows).toEqual([{ key: second[0].eventId }]);
});

test('transient retry stores only safe code, respects available_at, max attempts and crash budget', async () => {
  const a = await worker(async () => { throw new Error('secret credentials'); }, { ...config, maxAttempts: 2, retryBaseMs: 60000, retryMaxMs: 60000 });
  await events(2); const [claim] = await a.service.claim(); expect(await a.service.process(claim)).toBe('retry');
  expect(await a.service.claim()).toEqual([]);
  await database().connection.pool.query("update outbox_deliveries set available_at=clock_timestamp()-interval '1 second'");
  const [retry] = await a.service.claim(); expect(await a.service.process(retry)).toBe('dead');
  expect(await a.service.claim()).toEqual([]);
  const rows = (await database().connection.pool.query("select last_error,attempts from outbox_deliveries where status='dead'")).rows;
  expect(rows).toEqual([{ last_error: 'TRANSIENT_FAILURE', attempts: 2 }]);
  // Исчерпавший попытки процесс может умереть до handle. Reclaim должен park в dead без attempt #3.
  const other = await events(); const [crash] = await a.service.claim(); expect(crash.eventId).toBe(other[0].eventId);
  await expire(); const [again] = await a.service.claim(); await expire(); expect(again).toBeDefined();
  expect(await a.service.claim()).toEqual([]);
  expect((await database().connection.pool.query('select last_error,attempts from outbox_deliveries where event_id=$1', [crash.eventId])).rows[0])
    .toEqual({ last_error: 'ATTEMPTS_EXHAUSTED', attempts: 2 });
});

test('unsupported contract never calls handler or creates success marker', async () => {
  await events(); const pool = database().connection.pool;
  // DBA-only corruption simulates incompatible stored input; normal producer/immutable guard forbids this.
  const client = await pool.connect();
  try {
    await client.query('begin'); await client.query('alter table outbox_events disable trigger outbox_events_immutable');
    await client.query("update outbox_events set envelope=jsonb_set(envelope,'{schemaVersion}','2')");
    await client.query('alter table outbox_events enable trigger outbox_events_immutable'); await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  const handle = jest.fn(effect); const a = await worker(handle); const [claim] = await a.service.claim();
  expect(await a.service.process(claim)).toBe('dead'); expect(handle).not.toHaveBeenCalled();
  expect((await state()).markers).toBe(0);
  expect((await pool.query('select last_error from outbox_deliveries')).rows[0].last_error).toBe('UNSUPPORTED_EVENT');
});

test('connection crash during handler rolls back effect before retry by a new worker', async () => {
  let pid = 0; let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  const a = await worker(async (context, event) => {
    await effect(context, event); pid = (await transactionClient(context).execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    entered(); await barrier;
  });
  await events(); const [claim] = await a.service.claim(); const processing = a.service.process(claim);
  try {
    await started; await database().connection.pool.query('select pg_terminate_backend($1)', [pid]); release();
    expect(await processing).toBe('retry'); expect((await state()).effects).toBe(0); expect((await state()).markers).toBe(0);
    const b = await worker(); await database().connection.pool.query("update outbox_deliveries set available_at=clock_timestamp()-interval '1 second'");
    const [next] = await b.service.claim(); expect(await b.service.process(next)).toBe('completed');
  } finally { release(); await processing; }
});

test('consumer gap is dead; runtime role can process and cannot erase markers or move cursor backwards', async () => {
  const a = await worker(); await events();
  const [claim] = await a.service.claim();
  const roleRunner: TransactionRunner = { run: work => a.runner.run(async context => {
    await transactionClient(context).execute(sql`set local role warehouse_app`); return work(context);
  }) };
  // Реальный production service/repository, меняется только login role границы runner.
  const { HandlerRegistry } = await import('@backend/infrastructure/worker/services/handler-registry');
  const restricted = new WorkerService(roleRunner, a.repository, new HandlerRegistry([{ destination: 'inventory.putaway',
    handle: async (context, event) => { await audit.write(context, { actorType: 'system', actorId: randomUUID(),
      correlationId: event.correlationId, reasonCode: 'worker-test', action: 'worker.test-handled', entityType: 'receipt', entityId: event.aggregateId }); } }]), config);
  expect(await restricted.process(claim)).toBe('completed');
  const pool = database().connection.pool;
  await expect(pool.query('delete from processed_events')).rejects.toMatchObject({ code: '42501' });
  await expect(pool.query('update consumer_streams set last_processed_version=0')).rejects.toMatchObject({ code: '42501' });
  await expect(pool.query('truncate consumer_streams')).rejects.toMatchObject({ code: '42501' });
  const next = await events(2);
  await pool.query('insert into consumer_streams(consumer_name,aggregate_type,aggregate_id,last_processed_version) values($1,$2,$3,1)', ['inventory.putaway', 'receipt', next[0].aggregateId]);
  const [gap] = await a.service.claim(); expect(await a.service.process(gap)).toBe('dead');
  expect((await pool.query('select last_error from outbox_deliveries where event_id=$1', [gap.eventId])).rows[0].last_error).toBe('CURSOR_MISMATCH');
});

test('empty production registry leaves delivery pending and starts no implicit no-op', async () => {
  await events(); const context = await database().createWorkerApplication(); contexts.push(context);
  expect(await context.get(WorkerService).claim()).toEqual([]);
  expect((await database().connection.pool.query('select status,attempts from outbox_deliveries')).rows).toEqual([{ status: 'pending', attempts: 0 }]);
});
