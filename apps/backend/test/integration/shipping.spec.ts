/** @file WMS-206: реальные shipment, возврат B3, HTTP dedup, locks, rollback и независимая сверка ledger. */
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import type { Response as TestResponse } from 'supertest';
import { ShippingService } from '@backend/modules/fulfillment/services/shipping.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { reservedPickingFixture, warehouseCommand } from '../support/reserved-picking.fixture';
import { identityFixture, withIdentity } from '../support/identity.fixture';
import { waitForDatabaseLock } from '../support/database-lock';
const db = useDatabaseSuite();
let app: INestApplication, worker: INestApplicationContext;
beforeAll(async () => {
  app = await db().createHttpApplication();
  worker = await db().createWorkerApplication();
});
/** Подтверждённая staged партия создаётся production picking, без SQL подмены остатков. */
async function setup(picked = 10) {
  const x = await reservedPickingFixture(app, worker, db());
  await warehouseCommand(app, `picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  await warehouseCommand(app, `picking-tasks/${x.task.id}/confirm`, x.picker, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: picked,
    targetLocationId: x.fixture.shipping.id,
    shortage: false,
  }).expect(200);
  const o = await readOrder(x);
  return {
    ...x,
    allocationId: o.lines[0].allocations.find(
      (a: { locationKind: string; active: number }) =>
        a.locationKind === 'shipping' && a.active > 0,
    ).id,
  };
}
/** GET — текущий снимок; replay команды сравнивается отдельно с исходным ответом. */
async function readOrder(x: Awaited<ReturnType<typeof reservedPickingFixture>>) {
  return (
    await withIdentity(
      request(app.getHttpServer()).get(`/api/v1/orders/${x.order.id}`),
      x.manager,
    ).expect(200)
  ).body;
}
/** Явная выбранная партия shipping, без скрытого «взять сколько есть». */
async function prepare(x: Awaited<ReturnType<typeof setup>>, quantity: number) {
  return (
    await warehouseCommand(app, `orders/${x.order.id}/shipments`, x.picker, {
      reasonCode: 'customer-dispatch',
      lines: [{ allocationId: x.allocationId, quantity }],
    }).expect(201)
  ).body;
}
/** Проверяем reserved независимо от application вычислений, включая каждый отсутствующий allocation balance. */
async function reconcile() {
  expect(
    (
      await db().connection.pool.query(
        'select b.id from stock_balances b left join stock_allocations a on a.balance_id=b.id group by b.id having b.reserved<>coalesce(sum(a.active),0)',
      )
    ).rows,
  ).toEqual([]);
}
/** B3 требует полный вектор по order line. Его количество не вводится как новая дельта stock. */
function completeReturn(
  x: Awaited<ReturnType<typeof reservedPickingFixture>>,
  quantity: number,
  key = randomUUID(),
) {
  return warehouseCommand(
    app,
    `orders/${x.order.id}/cancellation-return`,
    x.picker,
    {
      reasonCode: 'customer-cancelled',
      lines: [{ lineId: x.order.lines[0].id, quantity, targetLocationId: x.fixture.storage.id }],
    },
    key,
  );
}
test('partial shipment and exact replay do not reopen shipped quantity or debit twice', async () => {
  const x = await setup();
  const first = await prepare(x, 6);
  const key = randomUUID();
  const posted = await warehouseCommand(
    app,
    `shipments/${first.id}/post`,
    x.picker,
    {},
    key,
  ).expect(200);
  expect(posted.body.status).toBe('posted');
  expect(
    (await warehouseCommand(app, `shipments/${first.id}/post`, x.picker, {}, key).expect(200)).body,
  ).toEqual(posted.body);
  await warehouseCommand(app, `shipments/${first.id}/post`, x.picker).expect(409);
  const o = await readOrder(x);
  expect(o.lines[0]).toMatchObject({ open: 0, reservedShipping: 4, shipped: 6, cancelled: 0 });
  const second = await prepare(x, 4);
  await warehouseCommand(app, `shipments/${second.id}/post`, x.picker).expect(200);
  expect((await readOrder(x)).status).toBe('completed');
  expect(
    (
      await db().connection.pool.query(
        "select sum(quantity)::int q from stock_movements where kind='shipment'",
      )
    ).rows[0].q,
  ).toBe(10);
  await reconcile();
});
test('two prepared shipments compete for the same last staged stock without overshipping', async () => {
  const x = await setup();
  const a = await prepare(x, 6),
    b = await prepare(x, 6);
  const secondSession = await identityFixture(app, { userId: x.picker.userId });
  const blocker = await db().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from orders where id=$1 for update', [x.order.id]);
  const pending = Promise.allSettled([
    warehouseCommand(app, `shipments/${a.id}/post`, x.picker).then((r) => r),
    warehouseCommand(app, `shipments/${b.id}/post`, secondSession).then((r) => r),
  ]);
  try {
    await waitForDatabaseLock(db(), 'orders', 2);
    await blocker.query('commit');
    const r = await pending;
    expect(r.map((v) => (v.status === 'fulfilled' ? v.value.status : 0)).sort()).toEqual([
      200, 409,
    ]);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await pending;
  }
  expect((await readOrder(x)).lines[0]).toMatchObject({ shipped: 6, reservedShipping: 4 });
  await reconcile();
});
test('cancel pending freezes shipping; physical full return preserves already shipped quantity', async () => {
  const x = await setup();
  const shipment = await prepare(x, 6);
  await warehouseCommand(app, `shipments/${shipment.id}/post`, x.picker).expect(200);
  const stale = await prepare(x, 4);
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager)
    .expect(200)
    .expect((r) => expect(r.body.status).toBe('cancel_pending'));
  await warehouseCommand(app, `shipments/${stale.id}/post`, x.picker).expect(409);
  await completeReturn(x, 3).expect(400);
  const key = randomUUID();
  const returned = await completeReturn(x, 4, key).expect(200);
  expect(returned.body.status).toBe('closed_mixed');
  expect(returned.body.lines[0]).toMatchObject({
    shipped: 6,
    cancelled: 4,
    reservedShipping: 0,
    reservedStorage: 0,
    open: 0,
  });
  expect((await completeReturn(x, 4, key).expect(200)).body).toEqual(returned.body);
  await completeReturn(x, 4).expect(409);
  expect(
    (await db().connection.pool.query('select sum(on_hand)::int q from stock_balances')).rows[0].q,
  ).toBe(4);
  await reconcile();
});
test('return after partial picking cancels remaining plan but preserves picked history', async () => {
  const x = await setup(6);
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).expect(200);
  await completeReturn(x, 6)
    .expect(200)
    .expect((r) => expect(r.body.status).toBe('cancelled'));
  expect(
    (await db().connection.pool.query('select picked_total,cancelled_unpicked from picking_lines'))
      .rows,
  ).toEqual([{ picked_total: 6, cancelled_unpicked: 4 }]);
  expect(
    (
      await db().connection.pool.query(
        'select sum(on_hand)::int q,sum(reserved)::int r from stock_balances',
      )
    ).rows[0],
  ).toEqual({ q: 10, r: 0 });
  await reconcile();
});
test('draft cancellation preserves reserve; warehouse permissions and revoked replay are enforced', async () => {
  const x = await setup();
  const a = await prepare(x, 6);
  await warehouseCommand(app, `shipments/${a.id}/cancel`, x.picker, {
    reasonCode: 'wrong-dispatch',
  }).expect(200);
  await warehouseCommand(app, `shipments/${a.id}/post`, x.picker).expect(409);
  await warehouseCommand(app, `orders/${x.order.id}/shipments`, x.manager, {
    reasonCode: 'dispatch',
    lines: [{ allocationId: x.allocationId, quantity: 1 }],
  }).expect(403);
  const stranger = await identityFixture(app);
  await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/shipments/${a.id}`),
    stranger,
  ).expect(403);
  const b = await prepare(x, 4),
    key = randomUUID();
  await warehouseCommand(app, `shipments/${b.id}/post`, x.picker, {}, key).expect(200);
  await db().connection.pool.query('delete from warehouse_roles where user_id=$1', [
    x.picker.userId,
  ]);
  await warehouseCommand(app, `shipments/${b.id}/post`, x.picker, {}, key).expect(403);
  await reconcile();
});
/** AFTER faults проверяют откат каждого существенного шага, включая success result. */
test.each([
  'stock_balances',
  'stock_allocations',
  'shipping_effects',
  'stock_movements',
  'shipments',
  'audit_entries',
  'outbox_events',
  'http_idempotency',
])('shipment fault after %s rolls back and the same key can retry', async (table) => {
  const x = await setup();
  const shipment = await prepare(x, 6),
    pool = db().connection.pool,
    key = randomUUID();
  await pool.query(
    "create function shipment_fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic shipping fault'; end $$",
  );
  const operation = [
    'stock_balances',
    'stock_allocations',
    'shipments',
    'http_idempotency',
  ].includes(table)
    ? 'update'
    : 'insert';
  try {
    await pool.query(
      `create trigger shipment_fault after ${operation} on ${table} for each row execute function shipment_fault()`,
    );
    await warehouseCommand(app, `shipments/${shipment.id}/post`, x.picker, {}, key).expect(500);
  } finally {
    await pool.query(`drop trigger if exists shipment_fault on ${table}`);
    await pool.query('drop function shipment_fault()');
  }
  expect((await pool.query('select * from shipping_effects')).rows).toEqual([]);
  expect((await readOrder(x)).lines[0]).toMatchObject({ shipped: 0, reservedShipping: 10 });
  await reconcile();
  await warehouseCommand(app, `shipments/${shipment.id}/post`, x.picker, {}, key).expect(200);
  await reconcile();
});

/** Полный возврат после physical move обязан откатиться, если не сохранилась любая часть учёта. */
test.each([
  'stock_balances',
  'stock_allocations',
  'shipping_effects',
  'stock_movements',
  'audit_entries',
  'outbox_events',
  'http_idempotency',
])('return fault after %s preserves cancel_pending and can retry', async (table) => {
  const x = await setup(6);
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).expect(200);
  const pool = db().connection.pool,
    key = randomUUID();
  await pool.query(
    "create function return_fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic return fault'; end $$",
  );
  const operation = ['stock_balances', 'stock_allocations', 'http_idempotency'].includes(table)
    ? 'update'
    : 'insert';
  try {
    await pool.query(
      `create trigger return_fault after ${operation} on ${table} for each row execute function return_fault()`,
    );
    await completeReturn(x, 6, key).expect(500);
  } finally {
    await pool.query(`drop trigger if exists return_fault on ${table}`);
    await pool.query('drop function return_fault()');
  }
  expect((await readOrder(x)).status).toBe('cancel_pending');
  expect((await db().connection.pool.query('select * from shipping_effects')).rows).toEqual([]);
  await reconcile();
  await completeReturn(x, 6, key).expect(200);
  await reconcile();
});
test('cancel and shipment race preserves posted history and cancels only unshipped remainder', async () => {
  const x = await setup();
  const doc = await prepare(x, 6);
  const blocker = await db().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from orders where id=$1 for update', [x.order.id]);
  const pending = Promise.allSettled([
    warehouseCommand(app, `shipments/${doc.id}/post`, x.picker).then((r) => r),
    warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).then((r) => r),
  ]);
  try {
    await waitForDatabaseLock(db(), 'orders', 2);
    await blocker.query('commit');
    const result = await pending;
    const status = (
      await db().connection.pool.query('select status from shipments where id=$1', [doc.id])
    ).rows[0].status;
    expect(result.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort()).toEqual(
      status === 'posted' ? [200, 200] : [200, 409],
    );
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await pending;
  }
  const o = await readOrder(x);
  expect(o.status).toBe('cancel_pending');
  const shipped = o.lines[0].shipped;
  await completeReturn(x, 10 - shipped)
    .expect(200)
    .expect((r) => expect(r.body.lines[0]).toMatchObject({ shipped, cancelled: 10 - shipped }));
  await reconcile();
});

/** Проверяет настоящий runtime login role: чтение/запись разрешены лишь нужными grants. */
test('runtime role ships and returns but cannot commit a return without closing cancellation', async () => {
  const x = await setup(),
    doc = await prepare(x, 6);
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  await runner.run(async (c) => {
    await transactionClient(c).execute(sql`set local role warehouse_app`);
    await app
      .get(ShippingService)
      .postShipment(c, doc.id, { ...x.fixture.metadata, actorId: x.picker.userId });
  });
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).expect(200);
  let error: unknown;
  try {
    await runner.run(async (c) => {
      await transactionClient(c).execute(sql`set local role warehouse_app`);
      await transactionClient(c).execute(
        sql`select id from orders where id=${x.order.id} for update`,
      );
      await app
        .get(InventoryService)
        .applyShippingEffects(
          c,
          x.order.id,
          'return',
          [{ allocationId: x.allocationId, quantity: 4, targetLocationId: x.fixture.storage.id }],
          { ...x.fixture.metadata, actorId: x.picker.userId },
        );
    });
  } catch (e) {
    error = e;
  }
  const codes: unknown[] = [];
  for (
    let cause = error as { code?: string; cause?: unknown } | undefined;
    cause;
    cause = cause.cause as typeof cause
  )
    codes.push(cause.code);
  expect(codes).toContain('23514');
  expect((await readOrder(x)).status).toBe('cancel_pending');
  await runner.run(async (c) => {
    await transactionClient(c).execute(sql`set local role warehouse_app`);
    await app.get(ShippingService).completeCancellationReturn(
      c,
      x.order.id,
      {
        reasonCode: 'customer-cancelled',
        lines: [
          { lineId: x.order.lines[0].id, quantity: 4, targetLocationId: x.fixture.storage.id },
        ],
      },
      { ...x.fixture.metadata, actorId: x.picker.userId },
    );
  });
  expect((await readOrder(x)).status).toBe('closed_mixed');
  await reconcile();
});
/** Нельзя хранить физический учёт меньше обязательств: CHECK отвергает расхождение раньше shipment.
 * Реальная физическая нехватка требует отдельной сверки, не неявного уменьшения reserved. */
test('physical stock below reservation is rejected and a wrong return zone leaves pending unchanged', async () => {
  const x = await setup(),
    client = await db().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role warehouse_app');
    await expect(
      client.query('update stock_balances set on_hand=reserved-1 where location_id=$1', [
        x.fixture.shipping.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('rollback');
    client.release();
  }
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).expect(200);
  await warehouseCommand(app, `orders/${x.order.id}/cancellation-return`, x.picker, {
    reasonCode: 'customer-cancelled',
    lines: [{ lineId: x.order.lines[0].id, quantity: 10, targetLocationId: x.fixture.shipping.id }],
  }).expect(400);
  expect((await readOrder(x)).status).toBe('cancel_pending');
  await reconcile();
});

/** Single расход не допускает дополнительных transfer legs с тем же effect даже под runtime ролью. */
test('shipping effect rejects extra movement legs before commit', async () => {
  const x = await setup(),
    doc = await prepare(x, 6);
  await warehouseCommand(app, `shipments/${doc.id}/post`, x.picker).expect(200);
  const client = await db().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role warehouse_app');
    await client.query(
      `insert into stock_movements(operation_id,warehouse_id,location_id,product_id,kind,quantity,shipping_effect_id,audit_id)
    select $1,warehouse_id,location_id,product_id,'transfer-out',quantity,shipping_effect_id,audit_id from stock_movements where kind='shipment' limit 1`,
      [randomUUID()],
    );
    await expect(client.query('commit')).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('rollback');
    client.release();
  }
  expect(
    (
      await db().connection.pool.query(
        'select count(*)::int n from stock_movements where shipping_effect_id is not null',
      )
    ).rows[0].n,
  ).toBe(1);
  await reconcile();
});

/** Regression: runtime INSERT не должен менять состав уже подготовленного документа.
 * Два разных allocations исключают ложный отказ только по UNIQUE(shipment,allocation). */
test('runtime role cannot append a line after draft creation commit', async () => {
  const x = await setup(6);
  await warehouseCommand(app, `picking-tasks/${x.task.id}/confirm`, x.picker, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: 4,
    shortage: false,
    targetLocationId: x.fixture.shipping.id,
  }).expect(200);
  const doc = await prepare(x, 2);
  const order = await readOrder(x);
  const other = order.lines[0].allocations.find(
    (a: { id: string; locationKind: string; active: number }) =>
      a.locationKind === 'shipping' && a.id !== x.allocationId && a.active > 0,
  );
  const client = await db().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role warehouse_app');
    await client.query('select id from orders where id=$1 for update', [x.order.id]);
    await expect(
      client.query(
        'insert into shipment_lines(id,shipment_id,allocation_id,quantity) values($1,$2,$3,1)',
        [randomUUID(), doc.id, other.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await client.query('rollback');
    client.release();
  }
  const snapshot = await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/shipments/${doc.id}`),
    x.picker,
  ).expect(200);
  expect(snapshot.body).toEqual(doc);
  await warehouseCommand(app, `shipments/${doc.id}/post`, x.picker).expect(200);
  await reconcile();
});

/** Все строки штатного immutable документа создаются вместе с header; guard не запрещает состав из нескольких строк. */
test('multi-line shipment can be prepared and posted atomically', async () => {
  const x = await setup(6);
  await warehouseCommand(app, `picking-tasks/${x.task.id}/confirm`, x.picker, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: 4,
    shortage: false,
    targetLocationId: x.fixture.shipping.id,
  }).expect(200);
  const order = await readOrder(x);
  const other = order.lines[0].allocations.find(
    (a: { id: string; locationKind: string; active: number }) =>
      a.locationKind === 'shipping' && a.id !== x.allocationId && a.active > 0,
  );
  const doc = await warehouseCommand(app, `orders/${x.order.id}/shipments`, x.picker, {
    reasonCode: 'customer-dispatch',
    lines: [
      { allocationId: x.allocationId, quantity: 2 },
      { allocationId: other.id, quantity: 1 },
    ],
  }).expect(201);
  expect(doc.body.lines).toHaveLength(2);
  await warehouseCommand(app, `shipments/${doc.body.id}/post`, x.picker).expect(200);
  expect((await readOrder(x)).lines[0]).toMatchObject({ shipped: 3, reservedShipping: 7 });
  await reconcile();
});

test('AC-QUALITY-01: reserve → partial pick → partial ship → cancel → return preserves ledger at every commit', async () => {
  const x = await reservedPickingFixture(app, worker, db());
  /** Независимый SQL oracle: не повторяет production расчёт, сверяет состояния всех allocations и balances. */
  async function assertCommittedLedger(onHand: number, reserved: number, consumed: number) {
    await reconcile();
    expect(
      (
        await db().connection.pool.query(
          'select coalesce(sum(on_hand),0)::int as "onHand",coalesce(sum(reserved),0)::int as reserved from stock_balances',
        )
      ).rows[0],
    ).toEqual({ onHand, reserved });
    expect(
      (
        await db().connection.pool.query(
          'select coalesce(sum(consumed),0)::int as consumed from stock_allocations',
        )
      ).rows[0].consumed,
    ).toBe(consumed);
    expect(
      (
        await db().connection.pool.query(
          'select id from stock_allocations where allocated::bigint<>active::bigint+released+transferred+consumed or active<0',
        )
      ).rows,
    ).toEqual([]);
  }
  await assertCommittedLedger(10, 10, 0);
  await warehouseCommand(app, `picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  await warehouseCommand(app, `picking-tasks/${x.task.id}/confirm`, x.picker, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: 6,
    targetLocationId: x.fixture.shipping.id,
    shortage: false,
  }).expect(200);
  await assertCommittedLedger(10, 10, 0);
  const allocation = (await readOrder(x)).lines[0].allocations.find(
    (a: { locationKind: string }) => a.locationKind === 'shipping',
  );
  const shipment = (
    await warehouseCommand(app, `orders/${x.order.id}/shipments`, x.picker, {
      reasonCode: 'sequence-check',
      lines: [{ allocationId: allocation.id, quantity: 4 }],
    }).expect(201)
  ).body;
  await warehouseCommand(app, `shipments/${shipment.id}/post`, x.picker).expect(200);
  await assertCommittedLedger(6, 6, 4);
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).expect(200);
  expect((await readOrder(x)).status).toBe('cancel_pending');
  await assertCommittedLedger(6, 6, 4);
  await completeReturn(x, 2).expect(200);
  await assertCommittedLedger(6, 0, 4);
  expect(await readOrder(x)).toMatchObject({
    status: 'closed_mixed',
    lines: [
      expect.objectContaining({
        shipped: 4,
        cancelled: 6,
        reservedStorage: 0,
        reservedShipping: 0,
      }),
    ],
  });
});

test('AC-R05-01: cancellation return and another order reservation complete without a stock lock inversion', async () => {
  const x = await postedReceiptFixture(app, 10);
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const inventory = app.get(InventoryService),
    warehouses = app.get(WarehousesService);
  const extra = await runner.run((c) =>
    warehouses.createLocation(c, {
      ...x.fixture.metadata,
      warehouseId: x.fixture.warehouse.id,
      code: 'RETURN',
      kind: 'storage',
    }),
  );
  // UUID генерирует production owner. Сортируем две реальные ячейки и только затем размещаем stock:
  // A<B гарантировано без случайных циклов генерации подходящего UUID.
  const [source, target] = [x.fixture.storage, extra].sort((a, b) => a.id.localeCompare(b.id));
  const place = async (receiptId: string, locationId: string) => {
    const [claim] = await worker.get(WorkerService).claim();
    expect(await worker.get(WorkerService).process(claim)).toBe('completed');
    const task = (
      await db().connection.pool.query('select id from putaway_tasks where source_receipt_id=$1', [
        receiptId,
      ])
    ).rows[0];
    await runner.run((c) =>
      inventory.executePutawayTask(c, task.id, locationId, x.fixture.metadata),
    );
  };
  await place(x.document.id, source.id);
  const manager = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'warehouse_supervisor',
  });
  const competitor = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'order_manager',
  });
  const createOrder = async (actor: typeof manager, quantity: number) => {
    const result = await warehouseCommand(app, 'orders', actor, {
      warehouseId: x.fixture.warehouse.id,
      lines: [{ productId: x.fixture.product.id, quantity }],
    }).expect(201);
    await warehouseCommand(app, `orders/${result.body.id}/confirm`, actor).expect(200);
    return result.body as { id: string; lines: { id: string }[] };
  };
  const order = await createOrder(manager, 10);
  await warehouseCommand(app, `orders/${order.id}/reserve`, manager, {
    lines: [{ lineId: order.lines[0].id, quantity: 10 }],
  }).expect(200);
  const task = await warehouseCommand(app, `orders/${order.id}/picking-tasks`, manager).expect(201);
  await warehouseCommand(app, `picking-tasks/${task.body.id}/start`, manager).expect(200);
  await warehouseCommand(app, `picking-tasks/${task.body.id}/confirm`, manager, {
    taskLineId: task.body.lines[0].id,
    actualQuantity: 3,
    targetLocationId: x.fixture.shipping.id,
    shortage: false,
  }).expect(200);
  await warehouseCommand(app, `orders/${order.id}/cancel`, manager).expect(200);
  // B существует до начала race, иначе ожидающий reserve snapshot не увидит новую позицию.
  const secondReceipt = await runner.run(async (c) => {
    const receiving = app.get(ReceivingService);
    const draft = await receiving.create(
      c,
      {
        warehouseId: x.fixture.warehouse.id,
        receivingLocationId: x.fixture.receiving.id,
        lines: [{ productId: x.fixture.product.id, quantity: 1 }],
      },
      x.fixture.metadata,
    );
    return receiving.post(c, draft.id, x.fixture.metadata);
  });
  await place(secondReceipt.id, target.id);
  const other = await createOrder(competitor, 1);
  let reached!: () => void, release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const apply = inventory.applyShippingEffects.bind(inventory);
  let returnPid = 0;
  const hook = jest
    .spyOn(inventory, 'applyShippingEffects')
    .mockImplementation(async (...args: Parameters<typeof apply>) => {
      const result = await apply(...args);
      returnPid = (
        await transactionClient(args[0]).execute<{ pid: number }>(sql`select pg_backend_pid() pid`)
      ).rows[0].pid;
      // Только test barrier: transaction и её реальные stock locks остаются открытыми.
      reached();
      await resume;
      return result;
    });
  type Outcome = { response: TestResponse } | { error: unknown };
  const observe = (p: PromiseLike<TestResponse>): Promise<Outcome> =>
    Promise.resolve(p).then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
  let returning: Promise<Outcome> | undefined, reserving: Promise<Outcome> | undefined;
  const key = randomUUID();
  const body = {
    reasonCode: 'customer-cancelled',
    lines: [{ lineId: order.lines[0].id, quantity: 3, targetLocationId: target.id }],
  };
  try {
    returning = observe(
      warehouseCommand(app, `orders/${order.id}/cancellation-return`, manager, body, key),
    );
    // Ошибка до hook должна завершить тест и освободить ресурсы, а не ждать Jest timeout.
    await Promise.race([
      barrier,
      returning.then((outcome) => {
        if ('error' in outcome) throw outcome.error;
        throw new Error(`Return ended before the stock barrier: ${outcome.response.status}`);
      }),
    ]);
    reserving = observe(
      warehouseCommand(app, `orders/${other.id}/reserve`, competitor, {
        lines: [{ lineId: other.lines[0].id, quantity: 1 }],
      }),
    );
    await waitForDatabaseLock(db(), 'stock_balances');
    expect(
      (
        await db().connection.pool.query(
          'select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) waiting',
          [returnPid],
        )
      ).rows[0].waiting,
    ).toBe(true);
    release();
    const [returned, reserved] = await Promise.all([returning, reserving]);
    if ('error' in returned) throw returned.error;
    if ('error' in reserved) throw reserved.error;
    expect(returned.response.status).toBe(200);
    expect(reserved.response.status).toBe(200);
    expect(returned.response.body).toMatchObject({
      status: 'cancelled',
      lines: [{ cancelled: 10, shipped: 0, reservedStorage: 0, reservedShipping: 0 }],
    });
    expect(reserved.response.body.lines[0]).toMatchObject({
      quantity: 1,
      reservedStorage: 1,
      reservedShipping: 0,
      open: 0,
    });
    expect(
      (
        await warehouseCommand(
          app,
          `orders/${order.id}/cancellation-return`,
          manager,
          body,
          key,
        ).expect(200)
      ).body,
    ).toEqual(returned.response.body);
    const balances = (
      await db().connection.pool.query(
        'select location_id,on_hand,reserved from stock_balances where warehouse_id=$1',
        [x.fixture.warehouse.id],
      )
    ).rows;
    expect(balances.find((b) => b.location_id === source.id)).toMatchObject({
      on_hand: 7,
      reserved: 1,
    });
    expect(balances.find((b) => b.location_id === target.id)).toMatchObject({
      on_hand: 4,
      reserved: 0,
    });
    expect(balances.find((b) => b.location_id === x.fixture.shipping.id)).toMatchObject({
      on_hand: 0,
      reserved: 0,
    });
    expect(
      (
        await db().connection.pool.query(
          "select count(*) from shipping_effects where order_id=$1 and kind='return'",
          [order.id],
        )
      ).rows[0].count,
    ).toBe('1');
    await reconcile();
  } finally {
    release();
    await Promise.allSettled([returning, reserving].filter((p) => p !== undefined));
    hook.mockRestore();
  }
});
