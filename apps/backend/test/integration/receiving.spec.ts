/** @file WMS-108: production HTTP/SQL, races по документу/ключу и rollback на каждом шаге реальной транзакции. */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { useDatabaseSuite } from '../support/database-harness';
import { waitForDatabaseLock } from '../support/database-lock';
import { validateEnvironment } from '@backend/infrastructure/config/environment';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import { TRANSACTION_RUNNER, TransactionRunner } from '@backend/shared/transactions/transaction.port';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import { ReceivingRepository } from '@backend/modules/receiving/repositories/receiving.repository';
import { MAX_STOCK_QUANTITY } from '@backend/shared/quantities/quantity';
import { MAX_RECEIPT_LINES } from '@backend/shared/events/event-registry';
import type { ReceiptDto } from '@backend/modules/receiving/dto/receipt.dto';
import { EventContracts } from '@backend/shared/events/services/event-contracts';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';

const database = useDatabaseSuite();
let app: INestApplication; let runner: TransactionRunner;
let fixture: Awaited<ReturnType<typeof createDevWarehouseFixtures>>;
beforeAll(async () => {
  app = await database().createHttpApplication({ config: validateEnvironment({ NODE_ENV: 'test',
    DATABASE_URL: database().config.databaseUrl, DEV_ACTOR_ENABLED: 'true', DEV_ACTOR_ID: randomUUID(), HTTP_HOST: '127.0.0.1' }) });
  await app.listen(0, '127.0.0.1'); runner = app.get(TRANSACTION_RUNNER);
});
beforeEach(async () => { fixture = await runner.run(context => createDevWarehouseFixtures(context, app.get(CatalogService), app.get(WarehousesService))); });

/** Только transport input: справочники строятся production builder, stock напрямую не записывается. */
function body() { return { warehouseId: fixture.warehouse.id, receivingLocationId: fixture.receiving.id,
  lines: [{ productId: fixture.product.id, quantity: 10 }] }; }
/** Реальные business HTTP routes; key задаётся caller для retry/races. */
function create(payload: unknown = body(), key = randomUUID()) {
  return request(app.getHttpServer()).post('/api/v1/receipts').set('Idempotency-Key', key).send(payload as object);
}
/** Posting не принимает бизнес-поля: использует сохранённый draft и server identity. */
function post(id: string, key = randomUUID()) {
  return request(app.getHttpServer()).post(`/api/v1/receipts/${id}/post`).set('Idempotency-Key', key).send({});
}
/** Удобное чтение только после проверенного 201; не копирует business service. */
async function draft(): Promise<ReceiptDto> { return (await create().expect(201)).body; }
/** SQL evidence общей атомарности, включая counter/stream/delivery и command claim. */
async function counts() {
  const { rows } = await database().connection.pool.query(`select
    (select count(*)::int from receipts) receipts, (select count(*)::int from receipt_lines) lines,
    (select count(*)::int from stock_balances) balances, (select count(*)::int from stock_movements) movements,
    (select count(*)::int from audit_entries where entity_type='receipt' or action='inventory.stock-received') audit,
    (select count(*)::int from outbox_events) events, (select count(*)::int from outbox_aggregate_sequences) sequences,
    (select count(*)::int from delivery_streams) streams, (select count(*)::int from outbox_deliveries) deliveries,
    (select count(*)::int from http_idempotency) commands`);
  return rows[0];
}

test('10 received: draft has no stock; posting commits one movement/event/pending delivery and no task', async () => {
  const document = await draft();
  expect(document).toMatchObject({ status: 'draft', postedAt: null, postedEventId: null, lines: [{ quantity: 10, position: 1 }] });
  expect(await counts()).toEqual({ receipts: 1, lines: 1, balances: 0, movements: 0, audit: 1, events: 0, sequences: 0, streams: 0, deliveries: 0, commands: 1 });
  const correlationId = randomUUID(); const key = randomUUID();
  const response = await post(document.id, key).set('X-Correlation-Id', correlationId).expect(200);
  const posted: ReceiptDto = response.body;
  expect(posted).toMatchObject({ id: document.id, status: 'posted', lines: document.lines });
  expect(await counts()).toEqual({ receipts: 1, lines: 1, balances: 1, movements: 1, audit: 3, events: 1, sequences: 1, streams: 1, deliveries: 1, commands: 2 });
  const { rows } = await database().connection.pool.query(`select b.on_hand,b.reserved,m.operation_id,e.envelope,
    d.status,d.attempts,s.last_completed_version as cursor from stock_balances b join stock_movements m on m.product_id=b.product_id
    cross join outbox_events e cross join outbox_deliveries d cross join delivery_streams s`);
  expect(rows[0]).toMatchObject({ on_hand: 10, reserved: 0, operation_id: document.lines[0].id, status: 'pending', attempts: 0, cursor: '0' });
  const event = new EventContracts().parseForHandler(JSON.stringify(rows[0].envelope));
  expect(event).toMatchObject({ eventId: posted.postedEventId, aggregateId: document.id, aggregateVersion: 1,
    occurredAt: posted.postedAt, correlationId, payload: { receiptId: document.id, lines: [{ receiptLineId: document.lines[0].id, quantity: 10 }] } });
  // Worker отсутствует: проверяем реальный schema catalog, а не фиктивный счётчик задач.
  expect((await database().connection.pool.query("select to_regclass('public.putaway_tasks') task")).rows[0].task).toBeNull();
  await request(app.getHttpServer()).get(`/api/v1/receipts/${document.id}`).expect(200).expect(res => expect(res.body).toEqual(posted));
  await post(document.id, key).expect(200).expect(res => expect(res.body).toEqual(posted));
  await post(document.id).expect(409).expect(res => expect(res.body.code).toBe('RECEIPT_ALREADY_POSTED'));
  expect((await counts()).movements).toBe(1);
  // Выполняем и документированный read-only SQL. В psql UUID задаёт -v;
  // здесь подставляется только UUID, уже полученный от сервера и проверенный форматом.
  expect(document.id).toMatch(/^[a-f0-9-]{36}$/);
  const proof = readFileSync(resolve('../../docs/examples/receiving-result.sql'), 'utf8').replaceAll(":'receipt_id'", `'${document.id}'`);
  await database().connection.pool.query(proof);
});

test('create replay normalizes UUID case; payload conflict and posting target participate in hash', async () => {
  const key = randomUUID(); const input = body();
  const first = await create(input, key).expect(201);
  expect(first.headers.location).toBe(`/api/v1/receipts/${first.body.id}`);
  await create({ ...input, warehouseId: input.warehouseId.toUpperCase(), receivingLocationId: input.receivingLocationId.toUpperCase(),
    lines: input.lines.map(line => ({ ...line, productId: line.productId.toUpperCase() })) }, key).expect(201)
    .expect(res => expect(res.body).toEqual(first.body));
  await create({ ...input, lines: [{ ...input.lines[0], quantity: 11 }] }, key).expect(409);
  const second = await draft(); const postingKey = randomUUID();
  await post(first.body.id, postingKey).expect(200);
  await post(second.id, postingKey).expect(409).expect(res => expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT'));
  await request(app.getHttpServer()).get(`/api/v1/receipts/${second.id}`).expect(200).expect(res => expect(res.body.status).toBe('draft'));
});

test.each([0, -1, 1.5, '10', MAX_STOCK_QUANTITY + 1])('HTTP rejects quantity %j without draft or claim', async quantity => {
  await create({ ...body(), lines: [{ productId: fixture.product.id, quantity }] }).expect(400);
  expect((await counts()).receipts).toBe(0); expect((await counts()).commands).toBe(0);
});
test.each([0, MAX_RECEIPT_LINES + 1])('HTTP rejects %i lines at DTO boundary', async length => {
  await create({ ...body(), lines: Array.from({ length }, () => body().lines[0]) }).expect(400);
  expect((await counts()).receipts).toBe(0);
});
test('duplicate products, missing refs, wrong warehouse and non-receiving location are safe 422', async () => {
  const input = body();
  await create({ ...input, lines: [...input.lines, { ...input.lines[0], productId: fixture.product.id.toUpperCase() }] }).expect(422);
  await create({ ...input, lines: [{ productId: randomUUID(), quantity: 10 }] }).expect(422).expect(res => expect(res.body.code).toBe('PRODUCT_NOT_FOUND'));
  for (const patch of [{ warehouseId: randomUUID() }, { receivingLocationId: randomUUID() }, { receivingLocationId: fixture.storage.id }, { receivingLocationId: fixture.shipping.id }]) {
    await create({ ...input, ...patch }).expect(422);
  }
  expect((await counts()).commands).toBe(0); expect((await counts()).audit).toBe(0);
});
test('malformed IDs/unknown fields/empty commands and disabled actor fail before side effects', async () => {
  await create({ ...body(), actorId: randomUUID() }).expect(400);
  await create({ ...body(), lines: [{ ...body().lines[0], lineId: randomUUID() }] }).expect(400);
  await request(app.getHttpServer()).post('/api/v1/receipts').send(body()).expect(400);
  await post('bad').expect(400); await post(randomUUID()).expect(404);
  await request(app.getHttpServer()).get(`/api/v1/receipts/${randomUUID()}`).expect(404);
  const document = await draft();
  await post(document.id).send({ status: 'posted' }).expect(400);
  const closed = await database().createHttpApplication();
  try {
    await request(closed.getHttpServer()).get(`/api/v1/receipts/${document.id}`).expect(403);
    await request(closed.getHttpServer()).post('/api/v1/receipts').set('Idempotency-Key', randomUUID()).send(body()).expect(403);
    await request(closed.getHttpServer()).post(`/api/v1/receipts/${document.id}/post`).set('Idempotency-Key', randomUUID()).send({}).expect(403);
  } finally { await closed.close(); }
});

test.each([{ sameKey: false, failFirst: false }, { sameKey: true, failFirst: false }, { sameKey: false, failFirst: true }])(
  'concurrent posting %j waits on a real PostgreSQL lock', async ({ sameKey, failFirst }) => {
    const document = await draft(); const repository = app.get(ReceivingRepository);
    const original = repository.find.bind(repository);
    let release!: () => void; let entered!: () => void; let held = false;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    // Оригинальный SELECT FOR UPDATE уже выполнен: удерживаем именно DB lock,
    // не подменяем repository fake-ответом. Barrier снимается даже при неуспешном assertion.
    const spy = jest.spyOn(repository, 'find').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[2] && !held) { held = true; entered(); await barrier; if (failFirst) throw new Error('fault after receipt lock'); }
      return result;
    });
    const key = randomUUID(); const first = post(document.id, key).then(res => res);
    let second: Promise<request.Response> | undefined;
    try {
      await started;
      second = post(document.id, sameKey ? key : randomUUID()).then(res => res);
      await waitForDatabaseLock(database(), sameKey ? 'http_idempotency' : 'receipts'); release();
      const responses = await Promise.all([first, second]);
      expect(responses.map(res => res.status)).toEqual(failFirst ? [500, 200] : sameKey ? [200, 200] : [200, 409]);
      if (sameKey) expect(responses[0].body).toEqual(responses[1].body);
      expect((await counts()).movements).toBe(1); expect((await counts()).events).toBe(1);
    } finally { release(); await Promise.allSettled([first, ...(second ? [second] : [])]); spy.mockRestore(); }
  });

/** SQL AFTER trigger имитирует сбой после реальной записи; только disposable admin может создать его. */
async function withSqlFault(table: string, operation: 'INSERT' | 'UPDATE', condition: string, work: () => Promise<void>) {
  // Имена/WHEN берутся только из статического test.each ниже; клиентские значения сюда не попадают.
  const pool = database().connection.pool;
  await pool.query(`create function public.wms108_fault() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
  try {
    await pool.query(`create trigger wms108_fault after ${operation} on public.${table} for each row ${condition} execute function public.wms108_fault()`);
    try { await work(); } finally { await pool.query(`drop trigger if exists wms108_fault on public.${table}`); }
  } finally { await pool.query('drop function public.wms108_fault()'); }
}

test.each([
  ['stock_balances', 'INSERT', ''], ['audit_entries', 'INSERT', "when (NEW.action='inventory.stock-received')"],
  ['stock_movements', 'INSERT', ''], ['audit_entries', 'INSERT', "when (NEW.action='receiving.receipt-posted')"],
  ['outbox_aggregate_sequences', 'INSERT', ''], ['outbox_events', 'INSERT', ''], ['delivery_streams', 'INSERT', ''],
  ['outbox_deliveries', 'INSERT', ''], ['receipts', 'UPDATE', ''], ['http_idempotency', 'UPDATE', ''],
] as const)('posting fault after %s %s %s rolls back every effect and permits original-key retry', async (table, operation, condition) => {
  const document = await draft(); const key = randomUUID();
  await withSqlFault(table, operation, condition, async () => {
    await post(document.id, key).expect(500).expect(res => expect(res.body.code).toBe('INTERNAL_ERROR'));
    expect(await counts()).toEqual({ receipts: 1, lines: 1, balances: 0, movements: 0, audit: 1, events: 0, sequences: 0, streams: 0, deliveries: 0, commands: 1 });
    await request(app.getHttpServer()).get(`/api/v1/receipts/${document.id}`).expect(200).expect(res => expect(res.body.status).toBe('draft'));
  });
  await post(document.id, key).expect(200); expect((await counts()).movements).toBe(1);
});
test.each([
  ['receipts', ''], ['receipt_lines', ''], ['audit_entries', "when (NEW.action='receiving.receipt-created')"],
] as const)('draft fault after %s rolls back header, lines, audit and claim', async (table, condition) => {
  const key = randomUUID();
  await withSqlFault(table, 'INSERT', condition, async () => {
    await create(body(), key).expect(500);
    expect(await counts()).toEqual({ receipts: 0, lines: 0, balances: 0, movements: 0, audit: 0, events: 0, sequences: 0, streams: 0, deliveries: 0, commands: 0 });
  });
  await create(body(), key).expect(201);
});

test('two-line failure rolls back previously received product; distinct documents add safely', async () => {
  const product = await runner.run(context => app.get(CatalogService).create(context, { ...fixture.metadata, sku: `T-${randomUUID()}`, name: 'Second' }));
  const document = (await create({ ...body(), lines: [...body().lines, { productId: product.id, quantity: 3 }] }).expect(201)).body;
  const repository = app.get(ReceivingRepository); const original = repository.markPosted.bind(repository);
  // Fault после всех двух начислений и outbox, но до commit: оба SKU обязаны исчезнуть.
  const spy = jest.spyOn(repository, 'markPosted').mockImplementation(async (...args) => { await original(...args); throw new Error('fault after final state'); });
  try { await post(document.id).expect(500); expect((await counts()).balances).toBe(0); } finally { spy.mockRestore(); }
  await post(document.id).expect(200);
  const other = await draft(); await post(other.id).expect(200);
  const balances = await database().connection.pool.query('select product_id,on_hand from stock_balances order by product_id');
  expect(balances.rows).toEqual(expect.arrayContaining([{ product_id: fixture.product.id, on_hand: 20 }, { product_id: product.id, on_hand: 3 }]));
});

test('int4 upper bound posts; overflow leaves second document draft', async () => {
  const document = (await create({ ...body(), lines: [{ productId: fixture.product.id, quantity: MAX_STOCK_QUANTITY }] }).expect(201)).body;
  await post(document.id).expect(200); const second = await draft();
  await post(second.id).expect(422).expect(res => expect(res.body.code).toBe('STOCK_LIMIT_EXCEEDED'));
  expect((await counts()).movements).toBe(1); expect((await counts()).events).toBe(1);
});

test('different receipts concurrently create one absent balance without lost update', async () => {
  const first = await draft(); const second = await draft();
  const responses = await Promise.all([post(first.id), post(second.id)]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect((await database().connection.pool.query('select on_hand from stock_balances')).rows).toEqual([{ on_hand: 20 }]);
  expect((await counts()).movements).toBe(2); expect((await counts()).events).toBe(2);
});

test('SQL draft constraints reject zero quantity, duplicate product/position and foreign location', async () => {
  const document = await draft(); const pool = database().connection.pool;
  const product = await runner.run(context => app.get(CatalogService).create(context, { ...fixture.metadata, sku: `T-${randomUUID()}`, name: 'Another' }));
  // Прямой SQL используется только для доказательства guards, а не как fixture business logic.
  const insert = (productId: string, position: number, quantity: number) => pool.query(
    'insert into receipt_lines(id,receipt_id,product_id,position,quantity) values($1,$2,$3,$4,$5)', [randomUUID(), document.id, productId, position, quantity]);
  await expect(insert(product.id, 2, 0)).rejects.toMatchObject({ code: '23514' });
  await expect(insert(product.id, MAX_RECEIPT_LINES + 1, 1)).rejects.toMatchObject({ code: '23514' });
  await expect(insert(product.id, 1, 1)).rejects.toMatchObject({ code: '23505' });
  await expect(insert(fixture.product.id, 2, 1)).rejects.toMatchObject({ code: '23505' });
  await expect(pool.query('insert into receipts(id,warehouse_id,receiving_location_id) values($1,$2,$3)',
    [randomUUID(), randomUUID(), fixture.receiving.id])).rejects.toMatchObject({ code: '23503' });
});

test('SQL constraints and runtime privileges protect receipt history', async () => {
  const document = await draft(); await post(document.id).expect(200);
  const pool = database().connection.pool;
  await expect(pool.query('update receipt_lines set quantity=11 where receipt_id=$1', [document.id])).rejects.toMatchObject({ code: '42501' });
  await expect(pool.query("update receipts set status='draft',posted_at=null,posted_event_id=null where id=$1", [document.id])).rejects.toMatchObject({ code: '42501' });
  await expect(pool.query('insert into receipt_lines(id,receipt_id,product_id,position,quantity) values($1,$2,$3,2,1)', [randomUUID(), document.id, fixture.product.id])).rejects.toMatchObject({ code: '23514' });
  for (const table of ['receipts', 'receipt_lines']) {
    await expect(pool.query(`delete from ${table}`)).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query(`truncate ${table} cascade`)).rejects.toMatchObject({ code: '42501' });
  }
  // Реальный restricted group, не superuser: UPDATE строк и DELETE header запрещены GRANT.
  const client = await pool.connect();
  try {
    await client.query('begin'); await client.query('set local role warehouse_app');
    await expect(client.query('update receipt_lines set quantity=11')).rejects.toMatchObject({ code: '42501' });
  } finally { await client.query('rollback'); client.release(); }
});

test('restricted warehouse_app can create and post using all real module services in one context', async () => {
  // SET LOCAL ROLE действует только до commit/rollback borrowed context; host/dev login не меняется.
  const document = await runner.run(async context => {
    await transactionClient(context).execute(sql`set local role warehouse_app`);
    const service = app.get(ReceivingService);
    const created = await service.create(context, body(), fixture.metadata);
    return service.post(context, created.id, fixture.metadata);
  });
  expect(document.status).toBe('posted'); expect((await counts()).movements).toBe(1);
});
