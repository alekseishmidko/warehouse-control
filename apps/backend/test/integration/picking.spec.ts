/** @file WMS-205: настоящие HTTP/SQL, идемпотентность, конкуренция исполнителей, отмена и fault rollback переноса резерва. */
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { PickingService } from '@backend/modules/fulfillment/services/picking.service';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { reservedPickingFixture } from '../support/reserved-picking.fixture';
import { identityFixture, withIdentity, TestIdentity } from '../support/identity.fixture';
import { waitForDatabaseLock } from '../support/database-lock';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
const db = useDatabaseSuite();
let app: INestApplication, worker: INestApplicationContext;
beforeAll(async () => {
  app = await db().createHttpApplication();
  worker = await db().createWorkerApplication();
});
/** Все команды проходят production session/CSRF/ACL; уникальный ключ по умолчанию означает новое действие. */
function command(path: string, actor: TestIdentity, body: object = {}, key = randomUUID()) {
  return withIdentity(request(app.getHttpServer()).post(`/api/v1/${path}`), actor)
    .set('Idempotency-Key', key)
    .send(body);
}
/** Receipt → worker → placement → order → reserve → plan. Бизнес-логику в fixture не копируем. */
const setup = () => reservedPickingFixture(app, worker, db());
/** Наблюдаемый ledger: каждый balance сверяется с независимой суммой активных allocations. */
async function reconcile() {
  expect(
    (
      await db().connection.pool.query(
        `select b.id from stock_balances b left join stock_allocations a on a.balance_id=b.id group by b.id having b.reserved<>coalesce(sum(a.active),0)`,
      )
    ).rows,
  ).toEqual([]);
}
/** Подтверждение одного приращения; target берём из test справочника shipping того же склада. */
function pick(
  x: Awaited<ReturnType<typeof setup>>,
  quantity: number,
  shortage = false,
  key = randomUUID(),
) {
  return command(
    `picking-tasks/${x.task.id}/confirm`,
    x.picker,
    {
      taskLineId: x.task.lines[0].id,
      actualQuantity: quantity,
      shortage,
      ...(quantity ? { targetLocationId: x.fixture.shipping.id } : {}),
    },
    key,
  );
}
test('partial picking and shortage preserve stock and reservation; retry never moves twice', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  const key = randomUUID();
  const first = await pick(x, 6, true, key).expect(200);
  expect(first.body).toMatchObject({
    status: 'shortage',
    assigneeId: x.picker.userId,
    lines: [{ planned: 10, pickedTotal: 6, remaining: 4 }],
  });
  expect((await pick(x, 6, true, key).expect(200)).body).toEqual(first.body);
  const o = await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/orders/${x.order.id}`),
    x.manager,
  ).expect(200);
  expect(o.body.lines[0]).toMatchObject({ open: 0, reservedStorage: 4, reservedShipping: 6 });
  await reconcile();
  // Отмена после переноса теперь переводит заказ в cancel_pending; отдельные проверки — shipping.spec.ts.
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  await pick(x, 4)
    .expect(200)
    .expect((r) => expect(r.body.status).toBe('completed'));
  await pick(x, 1).expect(409);
  expect(
    (await db().connection.pool.query('select count(*)::int n from picking_transfers')).rows[0].n,
  ).toBe(2);
  await reconcile();
});
test('zero shortage creates no movement; another executor, wrong zone and excess quantity are refused', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  const other = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'warehouse_operator',
  });
  await command(`picking-tasks/${x.task.id}/confirm`, other, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: 1,
    shortage: false,
    targetLocationId: x.fixture.shipping.id,
  }).expect(403);
  await pick(x, 11).expect(400);
  await command(`picking-tasks/${x.task.id}/confirm`, x.picker, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: 1,
    shortage: false,
    targetLocationId: x.fixture.receiving.id,
  }).expect(400);
  await pick(x, 0, true).expect(200);
  expect((await db().connection.pool.query('select * from picking_transfers')).rows).toEqual([]);
  await reconcile();
});
test('two pickers race for one assignment; only the winner can confirm', async () => {
  const x = await setup();
  const other = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'warehouse_operator',
  });
  const blocker = await db().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from orders where id=$1 for update', [x.order.id]);
  // Promise.allSettled присоединён до ожидания: оба запроса действительно дойдут до SQL lock.
  const pending = Promise.allSettled([
    command(`picking-tasks/${x.task.id}/start`, x.picker).then((r) => r),
    command(`picking-tasks/${x.task.id}/start`, other).then((r) => r),
  ]);
  try {
    await waitForDatabaseLock(db(), 'orders', 2);
    await blocker.query('commit');
    const results = await pending;
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([200, 409]);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await pending;
  }
});
test('cancel wins before confirmation: task cancelled, allocation released, no transfer or expiration', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  await command(`orders/${x.order.id}/cancel`, x.manager).expect(200);
  await pick(x, 1).expect(409);
  const t = await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/picking-tasks/${x.task.id}`),
    x.picker,
  ).expect(200);
  expect(t.body).toMatchObject({
    status: 'cancelled',
    lines: [{ pickedTotal: 0, cancelledUnpicked: 10, remaining: 0 }],
  });
  expect((await db().connection.pool.query('select * from picking_transfers')).rows).toEqual([]);
  await reconcile();
});
/** AFTER faults проверяют rollback уже выполненного SQL, не имитируют отказ до записи. */
test.each([
  'stock_balances',
  'stock_allocations',
  'stock_movements',
  'picking_transfers',
  'picking_lines',
  'audit_entries',
  'outbox_events',
  'http_idempotency',
])(
  'rollback after %s restores balances, allocations, task, event and HTTP result',
  async (table) => {
    const x = await setup();
    await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
    const pool = db().connection.pool;
    const before = (await pool.query('select count(*)::int n from outbox_events')).rows[0].n;
    await pool.query(
      "create function picking_fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic picking fault'; end $$",
    );
    const event = [
      'stock_balances',
      'stock_allocations',
      'picking_lines',
      'http_idempotency',
    ].includes(table)
      ? 'update'
      : 'insert';
    try {
      // table/event берутся только из фиксированного списка теста, не из пользовательского ввода.
      await pool.query(
        `create trigger picking_fault after ${event} on ${table} for each row execute function picking_fault()`,
      );
      await pick(x, 6).expect(500);
    } finally {
      await pool.query(`drop trigger if exists picking_fault on ${table}`);
      await pool.query('drop function picking_fault()');
    }
    expect((await pool.query('select count(*)::int n from outbox_events')).rows[0].n).toBe(before);
    expect((await pool.query('select * from picking_transfers')).rows).toEqual([]);
    expect((await pool.query('select picked_total from picking_lines')).rows).toEqual([
      { picked_total: 0 },
    ]);
    const balances = (
      await pool.query('select on_hand,reserved from stock_balances where location_id=$1', [
        x.fixture.storage.id,
      ])
    ).rows;
    expect(balances).toEqual([{ on_hand: 10, reserved: 10 }]);
    await reconcile();
    // После rollback можно выполнить ту же бизнес-операцию; резерв не остался наполовину перенесённым.
    await pick(x, 6).expect(200);
    await reconcile();
  },
);

test('concurrent confirmations cannot collect more than remaining', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  const secondSession = await identityFixture(app, { userId: x.picker.userId });
  const blocker = await db().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from orders where id=$1 for update', [x.order.id]);
  const pending = Promise.allSettled([
    pick(x, 6).then((r) => r),
    command(`picking-tasks/${x.task.id}/confirm`, secondSession, {
      taskLineId: x.task.lines[0].id,
      actualQuantity: 6,
      shortage: false,
      targetLocationId: x.fixture.shipping.id,
    }).then((r) => r),
  ]);
  try {
    await waitForDatabaseLock(db(), 'orders', 2);
    await blocker.query('commit');
    const r = await pending;
    expect(r.map((v) => (v.status === 'fulfilled' ? v.value.status : 0)).sort()).toEqual([
      200, 400,
    ]);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await pending;
  }
  expect((await db().connection.pool.query('select picked_total from picking_lines')).rows).toEqual(
    [{ picked_total: 6 }],
  );
  await reconcile();
});
test('cancel and confirmation race on the same order lock; no shipping stock is silently released', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  const blocker = await db().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from orders where id=$1 for update', [x.order.id]);
  const pending = Promise.allSettled([
    pick(x, 6).then((r) => r),
    command(`orders/${x.order.id}/cancel`, x.manager).then((r) => r),
  ]);
  try {
    await waitForDatabaseLock(db(), 'orders', 2);
    await blocker.query('commit');
    const r = await pending;
    const statuses = r.map((v) => (v.status === 'fulfilled' ? v.value.status : 0)).sort();
    const orderState = (
      await db().connection.pool.query('select status from orders where id=$1', [x.order.id])
    ).rows[0].status;
    expect(statuses).toEqual(orderState === 'cancel_pending' ? [200, 200] : [200, 409]);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await pending;
  }
  const t = (await db().connection.pool.query('select status from picking_tasks')).rows[0];
  if (t.status === 'cancelled')
    expect((await db().connection.pool.query('select * from picking_transfers')).rows).toEqual([]);
  else
    expect(
      (
        await db().connection.pool.query(
          "select sum(b.reserved)::int n from stock_balances b join locations l on l.id=b.location_id where l.kind='shipping'",
        )
      ).rows[0].n,
    ).toBe(6);
  await reconcile();
});
test('warehouse authorization is rechecked before saved replay; expiring a session never expires reservation', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  const stranger = await identityFixture(app);
  await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/picking-tasks/${x.task.id}`),
    stranger,
  ).expect(403);
  const key = randomUUID();
  await pick(x, 6, false, key).expect(200);
  await db().connection.pool.query('delete from warehouse_roles where user_id=$1', [
    x.picker.userId,
  ]);
  await pick(x, 6, false, key).expect(403);
  await db().connection.pool.query(
    "update sessions set idle_expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [x.picker.sessionId],
  );
  await pick(x, 1).expect(401);
  expect(
    (await db().connection.pool.query('select sum(reserved)::int n from stock_balances')).rows[0].n,
  ).toBe(10);
  await reconcile();
});
test('an open plan prevents duplicate planning and independent release of its reservation', async () => {
  const x = await setup();
  await command(`orders/${x.order.id}/picking-tasks`, x.manager).expect(409);
  await command(
    `orders/${x.order.id}/allocations/${x.order.lines[0]?.allocations?.[0]?.id ?? x.task.lines[0].allocationId}/release`,
    x.manager,
    { quantity: 1 },
  ).expect(409);
  await command(`picking-tasks/${x.task.id}/start`, x.manager).expect(403);
  await reconcile();
});

/** Проверяет реальные grants warehouse_app, а не только работу под владельцем таблиц. */
test('runtime role can pick but cannot rewrite transfer history or allocation lineage', async () => {
  const x = await setup();
  await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
    await transactionClient(c).execute(sql`set local role warehouse_app`);
    await app.get(PickingService).confirmPickedQuantity(
      c,
      x.task.id,
      x.picker.userId,
      {
        taskLineId: x.task.lines[0].id,
        actualQuantity: 6,
        targetLocationId: x.fixture.shipping.id,
        shortage: false,
      },
      { ...x.fixture.metadata, actorId: x.picker.userId },
    );
  });
  const client = await db().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role warehouse_app');
    await expect(client.query('update picking_transfers set quantity=1')).rejects.toMatchObject({
      code: '42501',
    });
  } finally {
    await client.query('rollback');
    client.release();
  }
  await reconcile();
});

/** Прямой потребитель inventory соблюдает order lock, но не вызывает fulfillment policy открытого плана.
 * Отказ обязана обеспечить БД на COMMIT под runtime ролью, включая частичное освобождение. */
test.each(['ready', 'in_progress', 'shortage'] as const)(
  'runtime inventory release cannot remove backing of %s picking plan',
  async (state) => {
    const x = await setup();
    if (state !== 'ready') await command(`picking-tasks/${x.task.id}/start`, x.picker).expect(200);
    if (state === 'shortage') await pick(x, 6, true).expect(200);
    const allocationId = x.task.lines[0].allocationId;
    let callbackFinished = false;
    const attempt = app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
      const tx = transactionClient(c);
      await tx.execute(sql`set local role warehouse_app`);
      await tx.execute(sql`select id from orders where id=${x.order.id} for update`);
      await app.get(InventoryService).release(c, x.order.lines[0].id, allocationId, 1);
      // UPDATE успешно выполнен: проверяем именно deferred отказ, а не сервисную валидацию.
      callbackFinished = true;
    });
    let failure: unknown;
    try {
      await attempt;
    } catch (error) {
      failure = error;
    }
    expect(callbackFinished).toBe(true);
    const codes: unknown[] = [];
    for (
      let error = failure as { code?: string; cause?: unknown } | undefined;
      error;
      error = error.cause as typeof error
    )
      codes.push(error.code);
    expect(codes).toContain('23514');
    const expected = state === 'shortage' ? 4 : 10;
    expect(
      (
        await db().connection.pool.query(
          'select active,released from stock_allocations where id=$1',
          [allocationId],
        )
      ).rows,
    ).toEqual([{ active: expected, released: 0 }]);
    expect(
      (
        await db().connection.pool.query('select status from picking_tasks where id=$1', [
          x.task.id,
        ])
      ).rows,
    ).toEqual([{ status: state }]);
    await reconcile();
  },
);

/** Снятие резерва перед отменой плана разрешено, если конечное состояние согласовано.
 * Доказывает, что deferred guard не зависит от порядка UPDATE в одной транзакции. */
test('runtime transaction may release then cancel the unpicked plan before commit', async () => {
  const x = await setup();
  await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
    const tx = transactionClient(c);
    await tx.execute(sql`set local role warehouse_app`);
    await tx.execute(sql`select id from orders where id=${x.order.id} for update`);
    await app
      .get(InventoryService)
      .release(c, x.order.lines[0].id, x.task.lines[0].allocationId, 10);
    await app
      .get(PickingService)
      .cancelUnpickedTasks(c, x.order.id, { ...x.fixture.metadata, actorId: x.manager.userId });
  });
  expect((await db().connection.pool.query('select status from picking_tasks')).rows).toEqual([
    { status: 'cancelled' },
  ]);
  await reconcile();
});

/** Имитируем старую дыру только в disposable admin-БД: trigger снимается на один legacy setup.
 * Выполняем именно preflight из новой миграции; он не должен придумывать резерв или закрывать задачу. */
test('migration preflight rejects an existing unbacked plan without repairing history', async () => {
  const x = await setup();
  const pool = db().connection.pool;
  try {
    await pool.query(
      'alter table stock_allocations disable trigger picking_allocation_backing_reconciled',
    );
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
      await transactionClient(c).execute(
        sql`select id from orders where id=${x.order.id} for update`,
      );
      await app
        .get(InventoryService)
        .release(c, x.order.lines[0].id, x.task.lines[0].allocationId, 10);
    });
  } finally {
    await pool.query(
      'alter table stock_allocations enable trigger picking_allocation_backing_reconciled',
    );
  }
  const preflight = readFileSync(
    resolve('drizzle/0028_picking_allocation_backing.sql'),
    'utf8',
  ).split('--> statement-breakpoint')[0];
  const client = await pool.connect();
  try {
    await client.query('begin');
    await expect(client.query(preflight)).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('rollback');
    client.release();
  }
  expect(
    (
      await pool.query('select active,released from stock_allocations where id=$1', [
        x.task.lines[0].allocationId,
      ])
    ).rows,
  ).toEqual([{ active: 0, released: 10 }]);
  expect(
    (await pool.query('select status from picking_tasks where id=$1', [x.task.id])).rows,
  ).toEqual([{ status: 'ready' }]);
});
