/** @file WMS-204 реальные HTTP/SQL locks: последнее количество, release/cancel, ledger reconciliation и fault rollback. */
import { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { identityFixture, withIdentity, TestIdentity } from '../support/identity.fixture';
import { waitForDatabaseLock } from '../support/database-lock';
import { FulfillmentService } from '@backend/modules/fulfillment/services/fulfillment.service';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { sql } from 'drizzle-orm';
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
const db = useDatabaseSuite();
let app: INestApplication;
let worker: INestApplicationContext;
beforeAll(async () => {
  app = await db().createHttpApplication();
  worker = await db().createWorkerApplication();
});
/** Настоящие receipt → worker → placement, без прямого начисления storage SQL. */
async function setup(quantity = 10) {
  const x = await postedReceiptFixture(app, quantity);
  const service = worker.get(WorkerService);
  const [claim] = await service.claim();
  expect(await service.process(claim)).toBe('completed');
  const id = (
    await db().connection.pool.query('select id from putaway_tasks where source_receipt_id=$1', [
      x.document.id,
    ])
  ).rows[0].id;
  await app
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((c) =>
      app.get(InventoryService).executePutawayTask(c, id, x.fixture.storage.id, x.fixture.metadata),
    );
  const actor = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'order_manager',
  });
  return { ...x, actor };
}
/** Каждый mutation проходит реальную session/CSRF/warehouse policy и idempotency storage. */
function command(path: string, actor: TestIdentity, body: object = {}, key = randomUUID()) {
  return withIdentity(request(app.getHttpServer()).post(`/api/v1/orders${path}`), actor)
    .set('Idempotency-Key', key)
    .send(body);
}
/** Создаёт и подтверждает заказ штатным HTTP. */
async function order(x: Awaited<ReturnType<typeof setup>>, q = 10) {
  const created = await command('', x.actor, {
    warehouseId: x.fixture.warehouse.id,
    lines: [{ productId: x.fixture.product.id, quantity: q }],
  }).expect(201);
  await command(`/${created.body.id}/confirm`, x.actor).expect(200);
  return created.body;
}
/** SQL reconciliation не повторяет подбор; сравнивает независимые balance и allocation записи. */
async function reconcile() {
  const rows = (
    await db().connection.pool.query(
      `select b.id from stock_balances b left join stock_allocations a on a.balance_id=b.id group by b.id having b.reserved<>coalesce(sum(a.active),0) or b.reserved<0 or b.reserved>b.on_hand`,
    )
  ).rows;
  expect(rows).toEqual([]);
}

test('explicit partial reserve, same-key replay, partial release and cancel preserve history', async () => {
  const x = await setup();
  const o = await order(x);
  const key = randomUUID();
  const path = `/${o.id}/reserve`;
  const body = { lines: [{ lineId: o.lines[0].id, quantity: 6 }] };
  const first = await command(path, x.actor, body, key).expect(200);
  expect(first.body.lines[0]).toMatchObject({ open: 4, reservedStorage: 6 });
  expect((await command(path, x.actor, body, key).expect(200)).body).toEqual(first.body);
  await command(path, x.actor, { lines: [{ lineId: o.lines[0].id, quantity: 5 }] }, key).expect(
    409,
  );
  const a = first.body.lines[0].allocations[0];
  const releaseKey = randomUUID();
  const released = await command(
    `/${o.id}/allocations/${a.id}/release`,
    x.actor,
    { quantity: 2 },
    releaseKey,
  ).expect(200);
  expect(released.body.lines[0]).toMatchObject({ open: 6, reservedStorage: 4 });
  expect(released.body.lines[0].allocations[0]).toMatchObject({
    allocated: 6,
    active: 4,
    released: 2,
  });
  expect(
    (
      await command(
        `/${o.id}/allocations/${a.id}/release`,
        x.actor,
        { quantity: 2 },
        releaseKey,
      ).expect(200)
    ).body,
  ).toEqual(released.body);
  await command(`/${o.id}/cancel`, x.actor).expect(200);
  await command(path, x.actor, body).expect(409);
  expect(
    (await db().connection.pool.query('select active,released from stock_allocations')).rows,
  ).toEqual([{ active: 0, released: 6 }]);
  await reconcile();
});

test('two orders race for last unit: one success and one full rollback', async () => {
  const x = await setup(1);
  const a = await order(x, 1);
  const b = await order(x, 1);
  const other = await identityFixture(app, { userId: x.actor.userId });
  const blocker = await db().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from stock_balances where location_id=$1 for update', [
    x.fixture.storage.id,
  ]);
  const pending = [
    command(`/${a.id}/reserve`, x.actor, { lines: [{ lineId: a.lines[0].id, quantity: 1 }] }),
    command(`/${b.id}/reserve`, other, { lines: [{ lineId: b.lines[0].id, quantity: 1 }] }),
  ].map((p) => p.then((r) => r));
  let results;
  try {
    await waitForDatabaseLock(db(), 'stock_balances', 2);
    await blocker.query('commit');
    results = await Promise.all(pending);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await Promise.allSettled(pending);
  }

  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await db().connection.pool.query('select count(*)::int n from stock_allocations')).rows[0].n,
  ).toBe(1);
  await reconcile();
});

test('insufficient explicit request never silently reserves available part', async () => {
  const x = await setup(6);
  const o = await order(x, 10);
  await command(`/${o.id}/reserve`, x.actor, {
    lines: [{ lineId: o.lines[0].id, quantity: 10 }],
  }).expect(409);
  expect(
    (await db().connection.pool.query('select count(*)::int n from stock_allocations')).rows[0].n,
  ).toBe(0);
  await reconcile();
});

test('reserve and release on same order serialize without losing active quantities', async () => {
  const x = await setup();
  const o = await order(x);
  const result = await command(`/${o.id}/reserve`, x.actor, {
    lines: [{ lineId: o.lines[0].id, quantity: 6 }],
  }).expect(200);
  const a = result.body.lines[0].allocations[0];
  const other = await identityFixture(app, { userId: x.actor.userId });
  const results = await Promise.all([
    command(`/${o.id}/reserve`, x.actor, { lines: [{ lineId: o.lines[0].id, quantity: 4 }] }),
    command(`/${o.id}/allocations/${a.id}/release`, other, { quantity: 2 }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  await reconcile();
  expect(
    (
      await db().connection.pool.query('select reserved from stock_balances where location_id=$1', [
        x.fixture.storage.id,
      ])
    ).rows[0].reserved,
  ).toBe(8);
});

/** AFTER INSERT fault возникает после balance UPDATE и allocation INSERT: весь callback обязан откатиться. */
test.each(['stock_allocations', 'audit_entries', 'outbox_events'])(
  'reserve rollback after %s failure and same-key retry',
  async (table) => {
    const x = await setup();
    const o = await order(x);
    const pool = db().connection.pool;
    const key = randomUUID();
    const before = (await pool.query('select count(*)::int n from outbox_events')).rows[0].n;
    await pool.query(
      "create function reserve_fault() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$",
    );
    try {
      await pool.query(
        `create trigger reserve_fault after insert on ${table} for each row execute function reserve_fault()`,
      );
      try {
        await command(
          `/${o.id}/reserve`,
          x.actor,
          { lines: [{ lineId: o.lines[0].id, quantity: 5 }] },
          key,
        ).expect(500);
      } finally {
        await pool.query(`drop trigger reserve_fault on ${table}`);
      }
    } finally {
      await pool.query('drop function reserve_fault()');
    }
    expect((await pool.query('select count(*)::int n from stock_allocations')).rows[0].n).toBe(0);
    expect((await pool.query('select count(*)::int n from outbox_events')).rows[0].n).toBe(before);
    await reconcile();
    await command(
      `/${o.id}/reserve`,
      x.actor,
      { lines: [{ lineId: o.lines[0].id, quantity: 5 }] },
      key,
    ).expect(200);
    await reconcile();
  },
);

test('warehouse permissions apply before saved replay', async () => {
  const x = await setup();
  const o = await order(x);
  const viewer = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'viewer',
  });
  await command(`/${o.id}/reserve`, viewer, {
    lines: [{ lineId: o.lines[0].id, quantity: 1 }],
  }).expect(403);
  const key = randomUUID();
  const body = { lines: [{ lineId: o.lines[0].id, quantity: 1 }] };
  await command(`/${o.id}/reserve`, x.actor, body, key).expect(200);
  await db().connection.pool.query('delete from warehouse_roles where user_id=$1', [
    x.actor.userId,
  ]);
  await command(`/${o.id}/reserve`, x.actor, body, key).expect(403);
});

/** Несколько storage balances одного SKU: подбор распределяет явно запрошенное количество и оставляет remainder открытым. */
test('reservation spans multiple storage cells in deterministic location order', async () => {
  const x = await setup(4);
  const next = await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
    const target = await app.get(WarehousesService).createLocation(c, {
      ...x.fixture.metadata,
      warehouseId: x.fixture.warehouse.id,
      code: 'SECOND',
      kind: 'storage',
    });
    const service = app.get(ReceivingService);
    const draft = await service.create(
      c,
      {
        warehouseId: x.fixture.warehouse.id,
        receivingLocationId: x.fixture.receiving.id,
        lines: [{ productId: x.fixture.product.id, quantity: 6 }],
      },
      x.fixture.metadata,
    );
    return { target, receipt: await service.post(c, draft.id, x.fixture.metadata) };
  });
  const w = worker.get(WorkerService);
  const [claim] = await w.claim();
  expect(await w.process(claim)).toBe('completed');
  const task = (
    await db().connection.pool.query('select id from putaway_tasks where source_receipt_id=$1', [
      next.receipt.id,
    ])
  ).rows[0].id;
  await app
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((c) =>
      app.get(InventoryService).executePutawayTask(c, task, next.target.id, x.fixture.metadata),
    );
  const o = await order(x, 10);
  const result = await command(`/${o.id}/reserve`, x.actor, {
    lines: [{ lineId: o.lines[0].id, quantity: 9 }],
  }).expect(200);
  expect(result.body.lines[0]).toMatchObject({ open: 1, reservedStorage: 9 });
  expect(result.body.lines[0].allocations).toHaveLength(2);
  const cells = (
    await db().connection.pool.query(
      'select on_hand,reserved from stock_balances where warehouse_id=$1 and location_id in ($2,$3) order by location_id',
      [x.fixture.warehouse.id, x.fixture.storage.id, next.target.id],
    )
  ).rows;
  expect(cells[0].reserved).toBe(cells[0].on_hand);
  expect(cells[1].reserved).toBe(9 - cells[0].reserved);
  await reconcile();
});

/** Deferred guard сверяет независимые ledger/balance значения; прямой SQL используется только как constraint test. */
test('database rejects reserved/allocation mismatch at commit', async () => {
  const x = await setup();
  const o = await order(x);
  await command(`/${o.id}/reserve`, x.actor, {
    lines: [{ lineId: o.lines[0].id, quantity: 3 }],
  }).expect(200);
  await expect(
    db().connection.pool.query(
      'update stock_balances set reserved=reserved+1 where location_id=$1',
      [x.fixture.storage.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await reconcile();
});

/** Отмена/release не могут оставить уменьшенный reserve после ошибки outbox. */
test.each(['release', 'cancel'])(
  '%s rollback preserves active allocation and permits same-key retry',
  async (action) => {
    const x = await setup();
    const o = await order(x);
    const reserved = await command(`/${o.id}/reserve`, x.actor, {
      lines: [{ lineId: o.lines[0].id, quantity: 6 }],
    }).expect(200);
    const a = reserved.body.lines[0].allocations[0];
    const key = randomUUID();
    const path = action === 'release' ? `/${o.id}/allocations/${a.id}/release` : `/${o.id}/cancel`;
    const body = action === 'release' ? { quantity: 2 } : {};
    const pool = db().connection.pool;
    await pool.query(
      "create function release_fault() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$",
    );
    try {
      await pool.query(
        'create trigger release_fault after insert on outbox_events for each row execute function release_fault()',
      );
      try {
        await command(path, x.actor, body, key).expect(500);
      } finally {
        await pool.query('drop trigger release_fault on outbox_events');
      }
    } finally {
      await pool.query('drop function release_fault()');
    }
    expect(
      (await pool.query('select active,released from stock_allocations where id=$1', [a.id]))
        .rows[0],
    ).toEqual({ active: 6, released: 0 });
    await reconcile();
    await command(path, x.actor, body, key).expect(200);
    await reconcile();
  },
);

/** Реальный runtime role может пройти весь borrowed сценарий; app не получает право менять immutable состав. */
test('warehouse_app can create confirm reserve and release with restricted grants', async () => {
  const x = await setup();
  const service = app.get(FulfillmentService);
  const run = <T>(
    work: (
      c: import('@backend/shared/transactions/transaction.port').TransactionContext,
    ) => Promise<T>,
  ) =>
    app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
      await transactionClient(c).execute(sql`set local role warehouse_app`);
      return work(c);
    });
  const o = await run((c) =>
    service.create(
      c,
      {
        warehouseId: x.fixture.warehouse.id,
        lines: [{ productId: x.fixture.product.id, quantity: 5 }],
      },
      x.fixture.metadata,
    ),
  );
  await run((c) => service.change(c, o.id, 'confirm', undefined, x.fixture.metadata));
  const reserved = await run((c) =>
    service.change(
      c,
      o.id,
      'reserve',
      { lines: [{ lineId: o.lines[0].id, quantity: 5 }] },
      x.fixture.metadata,
    ),
  );
  await run((c) =>
    service.change(
      c,
      o.id,
      'release',
      { quantity: 2 },
      x.fixture.metadata,
      reserved.lines[0].allocations[0].id,
    ),
  );
  await reconcile();
});

/** Первый SKU успешно меняет reserve, следующий недостаточен: откатывается весь многострочный вектор, включая audit. */
test('multi-line request rolls back earlier successful line when later product is insufficient', async () => {
  const x = await setup(4);
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const other = await runner.run((c) =>
    app
      .get(CatalogService)
      .create(c, { ...x.fixture.metadata, sku: `SECOND-${randomUUID()}`, name: 'Second product' }),
  );
  const [low, high] = [x.fixture.product.id, other.id].sort();
  if (low === other.id) {
    const receipt = await runner.run(async (c) => {
      const s = app.get(ReceivingService);
      const d = await s.create(
        c,
        {
          warehouseId: x.fixture.warehouse.id,
          receivingLocationId: x.fixture.receiving.id,
          lines: [{ productId: other.id, quantity: 4 }],
        },
        x.fixture.metadata,
      );
      return s.post(c, d.id, x.fixture.metadata);
    });
    const w = worker.get(WorkerService);
    const [claim] = await w.claim();
    expect(await w.process(claim)).toBe('completed');
    const task = (
      await db().connection.pool.query('select id from putaway_tasks where source_receipt_id=$1', [
        receipt.id,
      ])
    ).rows[0].id;
    await runner.run((c) =>
      app
        .get(InventoryService)
        .executePutawayTask(c, task, x.fixture.storage.id, x.fixture.metadata),
    );
  }
  const o = (
    await command('', x.actor, {
      warehouseId: x.fixture.warehouse.id,
      lines: [
        { productId: low, quantity: 4 },
        { productId: high, quantity: 5 },
      ],
    }).expect(201)
  ).body;
  await command(`/${o.id}/confirm`, x.actor).expect(200);
  await command(`/${o.id}/reserve`, x.actor, {
    lines: o.lines.map((l: { id: string; quantity: number }) => ({
      lineId: l.id,
      quantity: l.quantity,
    })),
  }).expect(409);
  expect(
    (await db().connection.pool.query('select count(*)::int n from stock_allocations')).rows[0].n,
  ).toBe(0);
  await reconcile();
});

test('draft state, duplicate SKU, empty command body and excessive release are rejected safely', async () => {
  const x = await setup();
  const body = {
    warehouseId: x.fixture.warehouse.id,
    lines: [{ productId: x.fixture.product.id, quantity: 5 }],
  };
  await command('', x.actor, { ...body, lines: [...body.lines, ...body.lines] }).expect(400);
  const draft = (await command('', x.actor, body).expect(201)).body;
  await command(`/${draft.id}/reserve`, x.actor, {
    lines: [{ lineId: draft.lines[0].id, quantity: 1 }],
  }).expect(409);
  await command(`/${draft.id}/confirm`, x.actor, { status: 'active' }).expect(400);
  await command(`/${draft.id}/confirm`, x.actor).expect(200);
  await command(`/${draft.id}/confirm`, x.actor).expect(409);
  const reserved = (
    await command(`/${draft.id}/reserve`, x.actor, {
      lines: [{ lineId: draft.lines[0].id, quantity: 1 }],
    }).expect(200)
  ).body;
  await command(
    `/${draft.id}/allocations/${reserved.lines[0].allocations[0].id}/release`,
    x.actor,
    { quantity: 2 },
  ).expect(400);
  await command(`/${draft.id}/allocations/${randomUUID()}/release`, x.actor, {
    quantity: 1,
  }).expect(404);
  await reconcile();
});

/** Даже без allocation history обе операции должны упасть на COMMIT под runtime ролью, а не только под DBA. */
test.each(['insert', 'update'])(
  'warehouse_app cannot %s reserved without allocations',
  async (operation) => {
    const x = await setup();
    const pool = db().connection.pool;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role warehouse_app');
      if (operation === 'insert') {
        // Новая ячейка того же склада, чтобы FK и UNIQUE не маскировали проверяемый trigger.
        await client.query(
          "insert into locations(id,warehouse_id,code,kind) values($1,$2,'REVIEW-STORAGE','storage')",
          [randomUUID(), x.fixture.warehouse.id],
        );
        const location = (
          await client.query(
            "select id from locations where warehouse_id=$1 and code='REVIEW-STORAGE'",
            [x.fixture.warehouse.id],
          )
        ).rows[0].id;
        await client.query(
          'insert into stock_balances(warehouse_id,location_id,product_id,on_hand,reserved) values($1,$2,$3,1,1)',
          [x.fixture.warehouse.id, location, x.fixture.product.id],
        );
      } else
        await client.query(
          'update stock_balances set reserved=1 where warehouse_id=$1 and location_id=$2',
          [x.fixture.warehouse.id, x.fixture.storage.id],
        );
      await expect(client.query('commit')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('rollback');
      client.release();
    }
    await reconcile();
  },
);

/** Preflight не «лечит» потерянные основания: legacy mismatch отвергается до замены guard, без порчи данных. */
test('migration preflight rejects existing mismatch and rolls back without guessing allocations', async () => {
  const x = await setup();
  const statements = readFileSync(
    resolve('drizzle/0025_strict_reservation_reconciliation.sql'),
    'utf8',
  ).split('--> statement-breakpoint');
  await expect(
    app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
      // Невалидный старый снимок имитируется только в откатываемой transaction disposable БД.
      await transactionClient(c).execute(
        sql`update stock_balances set reserved=1 where location_id=${x.fixture.storage.id}`,
      );
      await transactionClient(c).execute(sql.raw(statements[0]));
      await transactionClient(c).execute(sql.raw(statements[1]));
    }),
  ).rejects.toMatchObject({
    cause: { code: '23514', message: 'Reservation reconciliation required before migration' },
  });
  await reconcile();
});
