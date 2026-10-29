/** @file WMS-106: реальные migrations, атомарность stock/audit/outbox, PostgreSQL locks, uniqueness и immutable retention. */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { useDatabaseSuite } from '../support/database-harness';
import { outboxFixture } from '../support/outbox.fixture';
import {
  TRANSACTION_RUNNER,
  TransactionContext,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import {
  outboxAggregateSequences,
  outboxEvents,
  outboxDeliveries,
  deliveryStreams,
} from '@backend/infrastructure/outbox/outbox.schema';
import {
  MAX_AGGREGATE_VERSION,
  PUTAWAY_DESTINATION,
} from '@backend/infrastructure/outbox/outbox-destinations';
import { EventContracts } from '@backend/shared/events/services/event-contracts';
import { MAX_EVENT_BYTES } from '@backend/shared/events/event-registry';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import { stockBalances, stockMovements } from '@backend/modules/inventory/inventory.schema';
import { auditEntries } from '@backend/modules/audit/audit.schema';

const database = useDatabaseSuite();
let runner: TransactionRunner;
let outbox: OutboxService;
let inventory: InventoryService;
let catalog: CatalogService;
let warehouses: WarehousesService;
beforeAll(async () => {
  const app = await database().createHttpApplication();
  runner = app.get(TRANSACTION_RUNNER);
  outbox = app.get(OutboxService);
  inventory = app.get(InventoryService);
  catalog = app.get(CatalogService);
  warehouses = app.get(WarehousesService);
});

/** Проверяет отсутствие всех частей outbox, включая расход версии после неуспешного сценария. */
async function expectEmptyOutbox() {
  const { db } = database().connection;
  for (const table of [outboxEvents, outboxDeliveries, deliveryStreams, outboxAggregateSequences]) {
    expect(await db.select().from(table)).toEqual([]);
  }
}

test('migrations apply to fresh DB and again without changing schema or data', async () => {
  const { db, pool } = database().connection;
  const before = (
    await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations')
  ).rows[0].count;
  await migrate(db, { migrationsFolder: resolve('drizzle') });
  expect(
    (await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows[0]
      .count,
  ).toBe(before);
  await expectEmptyOutbox();
});

test('runtime role commits validated event, one pending delivery, zero cursor and counter atomically', async () => {
  const input = outboxFixture({ futureField: { source: 'demo' } });
  const event = await runner.run(async (context) => {
    await transactionClient(context).execute(sql`set local role warehouse_app`);
    const result = await outbox.append(context, input);
    // Пока callback открыт, другое соединение не видит ни одну часть незакоммиченной записи.
    await expectEmptyOutbox();
    return result;
  });
  expect(event).toMatchObject({
    ...input,
    aggregateVersion: 1,
    eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  const { db } = database().connection;
  expect(await db.select().from(outboxEvents)).toEqual([
    expect.objectContaining({ envelope: event, eventId: event.eventId }),
  ]);
  expect(await db.select().from(outboxDeliveries)).toEqual([
    expect.objectContaining({
      eventId: event.eventId,
      destination: PUTAWAY_DESTINATION,
      status: 'pending',
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
      lastError: null,
      completedAt: null,
    }),
  ]);
  expect(await db.select().from(deliveryStreams)).toEqual([
    expect.objectContaining({ destination: PUTAWAY_DESTINATION, lastCompletedVersion: 0 }),
  ]);
  expect(await db.select().from(outboxAggregateSequences)).toEqual([
    expect.objectContaining({ lastVersion: 1 }),
  ]);
});

test('stock, movement, audit and outbox commit together; failure after writer rolls back all business effects', async () => {
  const fixture = await runner.run((context) =>
    createDevWarehouseFixtures(context, catalog, warehouses),
  );
  const input = outboxFixture({
    payload: {
      receiptId: randomUUID(),
      warehouseId: fixture.warehouse.id,
      receivingLocationId: fixture.receiving.id,
      lines: [{ receiptLineId: randomUUID(), productId: fixture.product.id, quantity: 10 }],
    },
  });
  input.payload.receiptId = input.aggregateId;
  const receive = {
    ...fixture.metadata,
    warehouseId: fixture.warehouse.id,
    locationId: fixture.receiving.id,
    productId: fixture.product.id,
    quantity: 10,
    operationId: randomUUID(),
  };
  await expect(
    runner.run(async (context) => {
      await inventory.receive(context, receive);
      await outbox.append(context, input);
      throw new Error('planned failure after writer');
    }),
  ).rejects.toThrow('planned failure after writer');
  await expectEmptyOutbox();
  const { db } = database().connection;
  expect(await db.select().from(stockBalances)).toEqual([]);
  expect(await db.select().from(stockMovements)).toEqual([]);
  expect(await db.select().from(auditEntries)).toHaveLength(5); // Только исходные справочники.
  const event = await runner.run(async (context) => {
    await inventory.receive(context, receive);
    return outbox.append(context, input);
  });
  expect(event.aggregateVersion).toBe(1);
  expect(await db.select().from(stockBalances)).toEqual([expect.objectContaining({ onHand: 10 })]);
  expect(await db.select().from(stockMovements)).toHaveLength(1);
  expect(await db.select().from(auditEntries)).toHaveLength(6);
});

test('DB failure inserting delivery rolls back already inserted event, stream and counter', async () => {
  const { pool } = database().connection;
  const input = outboxFixture();
  // Временный fault trigger живёт только в disposable suite DB; runtime код не подменяется mock.
  await pool.query(`create function fail_outbox_delivery() returns trigger language plpgsql as $$
    begin raise exception 'planned delivery failure' using errcode='23514'; end $$`);
  try {
    await pool.query(
      'create trigger fail_outbox_delivery before insert on outbox_deliveries for each row execute function fail_outbox_delivery()',
    );
    await expect(runner.run((context) => outbox.append(context, input))).rejects.toMatchObject({
      cause: { code: '23514' },
    });
    await expectEmptyOutbox();
  } finally {
    await pool.query('drop function fail_outbox_delivery() cascade');
  }
  expect((await runner.run((context) => outbox.append(context, input))).aggregateVersion).toBe(1);
});

test('database connection loss before commit removes uncommitted event and permits a fresh append', async () => {
  const input = outboxFixture();
  let ready!: () => void;
  let release!: () => void;
  let backendPid = 0;
  const written = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failed = runner
    .run(async (context) => {
      backendPid = Number(
        (await transactionClient(context).execute(sql`select pg_backend_pid() as pid`)).rows[0].pid,
      );
      await outbox.append(context, input);
      ready();
      await barrier;
      // После server-side termination следующий запрос гарантированно обнаруживает потерю соединения.
      await transactionClient(context).execute(sql`select 1`);
    })
    .then(
      () => undefined,
      (error) => {
        ready();
        return error as Error;
      },
    );
  try {
    await written;
    expect(
      (
        await database().connection.pool.query('select pg_terminate_backend($1) as terminated', [
          backendPid,
        ])
      ).rows[0].terminated,
    ).toBe(true);
    release();
    expect(await failed).toBeInstanceOf(Error);
    await expectEmptyOutbox();
    // Новый context/connection, без автоматического повторения незавершённого callback.
    expect((await runner.run((context) => outbox.append(context, input))).aggregateVersion).toBe(1);
  } finally {
    release();
    await failed;
  }
});

test('later append preserves existing stream cursor/lease and earlier event envelope', async () => {
  const input = outboxFixture();
  const first = await runner.run((context) => outbox.append(context, input));
  const token = randomUUID();
  await database().connection.pool.query(
    "update delivery_streams set last_completed_version=1,lease_token=$1,lease_until=now()+interval '1 minute'",
    [token],
  );
  const second = await runner.run((context) => outbox.append(context, input));
  expect(second.aggregateVersion).toBe(2);
  expect(second.eventId).not.toBe(first.eventId);
  expect(await database().connection.db.select().from(deliveryStreams)).toEqual([
    expect.objectContaining({ lastCompletedVersion: 1, leaseToken: token }),
  ]);
  expect(await database().connection.db.select().from(outboxEvents)).toEqual(
    expect.arrayContaining([expect.objectContaining({ envelope: first })]),
  );
});

test('concurrent creation of absent counter allocates contiguous unique versions', async () => {
  const input = outboxFixture();
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const append = () =>
    runner
      .run(async (context) => {
        // Обе транзакции видят отсутствие counter до одновременного первого upsert.
        expect(await transactionClient(context).select().from(outboxAggregateSequences)).toEqual(
          [],
        );
        if (++arrivals === 2) release();
        await barrier;
        return outbox.append(context, input);
      })
      .catch((error) => {
        release();
        throw error;
      });
  const events = await Promise.all([append(), append()]);
  expect(events.map((event) => event.aggregateVersion).sort()).toEqual([1, 2]);
  expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
  expect(await database().connection.db.select().from(outboxDeliveries)).toHaveLength(2);
  expect(await database().connection.db.select().from(deliveryStreams)).toHaveLength(1);
});

test('rollback of lock holder allows waiting writer to reuse version; another aggregate proceeds', async () => {
  const input = outboxFixture();
  const other = outboxFixture();
  let ready!: () => void;
  let release!: () => void;
  let secondReady!: () => void;
  const firstReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const secondEntered = new Promise<void>((resolve) => {
    secondReady = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let secondPid = 0;
  // Сразу прикрепляем обработчик rejection, чтобы намеренный rollback не стал unhandled rejection.
  const first = runner
    .run(async (context) => {
      await outbox.append(context, input);
      ready();
      await barrier;
      throw new Error('planned rollback');
    })
    .then(
      () => undefined,
      (error) => {
        ready();
        return error as Error;
      },
    );
  let second: ReturnType<typeof outbox.append> | undefined;
  try {
    await firstReady;
    second = runner.run(async (context) => {
      secondPid = Number(
        (await transactionClient(context).execute(sql`select pg_backend_pid() as pid`)).rows[0].pid,
      );
      secondReady();
      return outbox.append(context, input);
    });
    // Attach rejection immediately even if a later assertion fails before await second.
    void second.catch(() => undefined);
    await secondEntered;
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const row = await database().connection.pool.query(
        'select cardinality(pg_blocking_pids($1)) > 0 as blocked',
        [secondPid],
      );
      if (row.rows[0].blocked) {
        blocked = true;
        break;
      }
      await delay(10);
    }
    expect(blocked).toBe(true); // Доказываем реальную блокировку, не полагаемся на sleep scheduling.
    expect((await runner.run((context) => outbox.append(context, other))).aggregateVersion).toBe(1);
    release();
    expect(await first).toMatchObject({ message: 'planned rollback' });
    expect((await second).aggregateVersion).toBe(1);
    expect((await runner.run((context) => outbox.append(context, input))).aggregateVersion).toBe(2);
  } finally {
    release();
    await first;
    if (second) await second.catch(() => undefined);
  }
});

test('UUID case does not split one aggregate into different counters', async () => {
  const input = outboxFixture();
  await runner.run((context) => outbox.append(context, input));
  const next = await runner.run((context) =>
    outbox.append(context, { ...input, aggregateId: input.aggregateId.toUpperCase() }),
  );
  expect(next.aggregateVersion).toBe(2);
  expect(await database().connection.db.select().from(outboxAggregateSequences)).toHaveLength(1);
});

test('multiple appends share one context and roll back all allocated versions together', async () => {
  const input = outboxFixture();
  await expect(
    runner.run(async (context) => {
      expect((await outbox.append(context, input)).aggregateVersion).toBe(1);
      expect((await outbox.append(context, input)).aggregateVersion).toBe(2);
      throw new Error('planned batch rollback');
    }),
  ).rejects.toThrow('planned batch rollback');
  await expectEmptyOutbox();
  expect((await runner.run((context) => outbox.append(context, input))).aggregateVersion).toBe(1);
});

test.each(['eventId', 'aggregateVersion', 'quantity', 'version'])(
  'invalid %s fails without allocating a counter',
  async (scenario) => {
    const input = outboxFixture();
    if (scenario === 'quantity') input.payload.lines[0].quantity = 0;
    else if (scenario === 'version') (input as Record<string, unknown>).schemaVersion = 2;
    else input[scenario] = scenario === 'eventId' ? randomUUID() : 42;
    await expect(runner.run((context) => outbox.append(context, input))).rejects.toThrow(
      'Event contract rejected',
    );
    await expectEmptyOutbox();
  },
);

test('custom JSON serialization cannot override writer-owned eventId or aggregateVersion', async () => {
  const input = outboxFixture();
  const suppliedId = randomUUID();
  // JSON.stringify использует toJSON до replacer. Writer повторно задаёт metadata после snapshot.
  const serialized = { ...input, eventId: suppliedId, aggregateVersion: 42 };
  const event = await runner.run((context) =>
    outbox.append(context, { ...input, toJSON: () => serialized }),
  );
  expect(event.eventId).not.toBe(suppliedId);
  expect(event.aggregateVersion).toBe(1);
  expect(await database().connection.db.select().from(outboxEvents)).toEqual([
    expect.objectContaining({ eventId: event.eventId, envelope: event }),
  ]);
});

test('forged, stale and cross-scope contexts cannot append', async () => {
  const input = outboxFixture();
  let stale!: TransactionContext;
  await runner.run(async (context) => {
    stale = context;
  });
  await expect(outbox.append({} as TransactionContext, input)).rejects.toThrow('inactive');
  await expect(outbox.append(stale, input)).rejects.toThrow('inactive');
  await runner.run(async () => {
    await expect(outbox.append(stale, input)).rejects.toThrow('scope');
  });
  await expectEmptyOutbox();
});

test('maximum version is safe and overflow cannot change counter or create an event', async () => {
  const input = outboxFixture();
  // Direct counter seed только для проверки unreachable-in-practice numeric boundary, не business fixture.
  await database()
    .connection.db.insert(outboxAggregateSequences)
    .values({
      aggregateType: 'receipt',
      aggregateId: input.aggregateId,
      lastVersion: MAX_AGGREGATE_VERSION - 1,
    });
  expect((await runner.run((context) => outbox.append(context, input))).aggregateVersion).toBe(
    MAX_AGGREGATE_VERSION,
  );
  await expect(runner.run((context) => outbox.append(context, input))).rejects.toThrow(
    'version limit',
  );
  expect(await database().connection.db.select().from(outboxEvents)).toHaveLength(1);
  expect(await database().connection.db.select().from(outboxAggregateSequences)).toEqual([
    expect.objectContaining({ lastVersion: MAX_AGGREGATE_VERSION }),
  ]);
});

test('final version byte growth is revalidated and rollback restores counter', async () => {
  const input = outboxFixture({ padding: '' });
  await database()
    .connection.db.insert(outboxAggregateSequences)
    .values({ aggregateType: 'receipt', aggregateId: input.aggregateId, lastVersion: 9 });
  const sample = new EventContracts().prepareForOutbox({
    ...input,
    eventId: randomUUID(),
    aggregateVersion: 1,
  });
  input.padding = 'a'.repeat(MAX_EVENT_BYTES - Buffer.byteLength(sample.message));
  await expect(runner.run((context) => outbox.append(context, input))).rejects.toMatchObject({
    code: 'MESSAGE_TOO_LARGE',
  });
  expect(await database().connection.db.select().from(outboxEvents)).toEqual([]);
  expect(await database().connection.db.select().from(outboxAggregateSequences)).toEqual([
    expect.objectContaining({ lastVersion: 9 }),
  ]);
});

test('DB enforces unique eventId, aggregate sequence, destination pair and FK', async () => {
  const event = await runner.run((context) => outbox.append(context, outboxFixture()));
  const { pool } = database().connection;
  const insert =
    'insert into outbox_events(event_id,aggregate_type,aggregate_id,aggregate_version,envelope) values($1,$2,$3,$4,$5::jsonb)';
  await expect(
    pool.query(insert, [event.eventId, 'receipt', event.aggregateId, 1, JSON.stringify(event)]),
  ).rejects.toMatchObject({ code: '23505' });
  const nextId = randomUUID();
  await expect(
    pool.query(insert, [
      nextId,
      'receipt',
      event.aggregateId,
      1,
      JSON.stringify({ ...event, eventId: nextId }),
    ]),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    pool.query('insert into outbox_deliveries(event_id,destination) values($1,$2)', [
      event.eventId,
      PUTAWAY_DESTINATION,
    ]),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    pool.query('insert into outbox_deliveries(event_id,destination) values($1,$2)', [
      randomUUID(),
      PUTAWAY_DESTINATION,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query('insert into outbox_deliveries(event_id,destination) values($1,$2)', [
      event.eventId,
      'unregistered',
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query(
      'insert into delivery_streams(destination,aggregate_type,aggregate_id) values($1,$2,$3)',
      [PUTAWAY_DESTINATION, 'receipt', event.aggregateId],
    ),
  ).rejects.toMatchObject({ code: '23505' });
});

test('DB rejects envelope identity mismatch independently of service validation', async () => {
  const event = await runner.run((context) => outbox.append(context, outboxFixture()));
  await expect(
    database().connection.pool.query(
      'insert into outbox_events(event_id,aggregate_type,aggregate_id,aggregate_version,envelope) values($1,$2,$3,$4,$5::jsonb)',
      [randomUUID(), 'receipt', event.aggregateId, 2, JSON.stringify(event)],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

test.each([
  'update outbox_deliveries set attempts=-1',
  "update outbox_deliveries set status='unknown'",
  "update outbox_deliveries set status='completed'",
  'update outbox_deliveries set lease_token=gen_random_uuid()',
  'update delivery_streams set last_completed_version=-1',
  'update delivery_streams set lease_until=now()',
  'update outbox_aggregate_sequences set last_version=9007199254740992',
])('DB rejects invalid delivery/stream/counter state: %s', async (statement) => {
  await runner.run((context) => outbox.append(context, outboxFixture()));
  // Direct SQL предназначен только для проверки CHECK, не имитирует worker или бизнес-логику.
  await expect(database().connection.pool.query(statement)).rejects.toMatchObject({
    code: '23514',
  });
});

test.each(['update', 'delete', 'truncate', 'disable-trigger'])(
  'runtime cannot %s events',
  async (operation) => {
    const input = outboxFixture();
    await runner.run((context) => outbox.append(context, input));
    const statements = {
      update: sql`update outbox_events set envelope='{}'::jsonb`,
      delete: sql`delete from outbox_events`,
      truncate: sql`truncate outbox_events, outbox_deliveries`,
      'disable-trigger': sql`alter table outbox_events disable trigger outbox_events_immutable`,
    };
    await expect(
      runner.run(async (context) => {
        await transactionClient(context).execute(sql`set local role warehouse_app`);
        await transactionClient(context).execute(statements[operation as keyof typeof statements]);
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect(await database().connection.db.select().from(outboxEvents)).toHaveLength(1);
  },
);

test.each(['outbox_events', 'outbox_deliveries', 'delivery_streams', 'outbox_aggregate_sequences'])(
  'owner cannot delete retained %s',
  async (table) => {
    await runner.run((context) => outbox.append(context, outboxFixture()));
    // Идентификатор только из закрытого test.each, не из пользовательского ввода.
    await expect(database().connection.pool.query(`delete from ${table}`)).rejects.toMatchObject({
      code: '42501',
    });
  },
);

test('owner cannot update envelope or truncate retained outbox graph', async () => {
  await runner.run((context) => outbox.append(context, outboxFixture()));
  const { pool } = database().connection;
  await expect(pool.query("update outbox_events set envelope='{}'::jsonb")).rejects.toMatchObject({
    code: '42501',
  });
  // Receipt теперь ссылается на event: CASCADE включает новый граф FK, но retained trigger всё равно запрещает удаление.
  await expect(
    pool.query(
      'truncate outbox_deliveries, outbox_events, delivery_streams, outbox_aggregate_sequences cascade',
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
