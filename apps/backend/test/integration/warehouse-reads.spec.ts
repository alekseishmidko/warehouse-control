/** @file WMS-207: реальные миграции, session/ACL, неизменные ключи и безопасные проекции складских списков. */
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { preparePageRequest, encodePageCursor } from '@backend/shared/pagination/keyset-page';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { reservedPickingFixture, warehouseCommand } from '../support/reserved-picking.fixture';
import { identityFixture, withIdentity, type TestIdentity } from '../support/identity.fixture';
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
const db = useDatabaseSuite();
let app: INestApplication, worker: INestApplicationContext;
beforeAll(async () => {
  app = await db().createHttpApplication();
  worker = await db().createWorkerApplication();
});
/** Настоящий auth guard, без обхода session и без модификации process.env. */
function list(
  warehouseId: string,
  resource: string,
  actor: TestIdentity,
  query: Record<string, string | undefined> = {},
) {
  return withIdentity(
    request(app.getHttpServer()).get(`/api/v1/warehouses/${warehouseId}/${resource}`).query(query),
    actor,
  );
}
const resources = [
  'balances',
  'movements',
  'receipts',
  'orders',
  'putaway-tasks',
  'picking-tasks',
  'shipments',
  'audit',
];
test('current balances/available, documents, tasks and movements use explicit JSON and exact filters', async () => {
  const x = await reservedPickingFixture(app, worker, db());
  const id = x.fixture.warehouse.id;
  const balances = (
    await list(id, 'balances', x.manager, {
      productId: x.fixture.product.id,
      locationId: x.fixture.storage.id,
      locationKind: 'storage',
    }).expect(200)
  ).body;
  expect(balances).toEqual({
    items: [expect.objectContaining({ warehouseId: id, onHand: 10, reserved: 10, available: 0 })],
    nextCursor: null,
  });
  expect(Object.keys(balances.items[0]).sort()).toEqual(
    [
      'id',
      'warehouseId',
      'locationId',
      'productId',
      'onHand',
      'reserved',
      'available',
      'locationKind',
    ].sort(),
  );
  const receipts = (
    await list(id, 'receipts', x.manager, {
      status: 'posted',
      receivingLocationId: x.fixture.receiving.id,
    }).expect(200)
  ).body;
  expect(receipts.items).toHaveLength(1);
  expect(receipts.items[0].id).toBe(x.document.id);
  expect(
    (await list(id, 'orders', x.manager, { status: 'active' }).expect(200)).body.items[0].id,
  ).toBe(x.order.id);
  expect(
    (
      await list(id, 'picking-tasks', x.manager, { orderId: x.order.id, status: 'ready' }).expect(
        200,
      )
    ).body.items[0].id,
  ).toBe(x.task.id);
  const putaway = (
    await list(id, 'putaway-tasks', x.manager, {
      productId: x.fixture.product.id,
      sourceReceiptId: x.document.id,
      status: 'completed',
    }).expect(200)
  ).body.items;
  expect(putaway).toHaveLength(1);
  expect(putaway[0].sourceEventId).toBe(x.document.postedEventId);
  const movements = (
    await list(id, 'movements', x.manager, {
      kind: 'receipt',
      locationId: x.fixture.receiving.id,
    }).expect(200)
  ).body.items;
  expect(movements).toHaveLength(1);
  expect(movements[0].quantity).toBe(10);
  expect(
    (
      await list(id, 'movements', x.manager, {
        auditId: movements[0].auditId,
        productId: x.fixture.product.id,
      }).expect(200)
    ).body.items,
  ).toHaveLength(1);
  const logs = (await list(id, 'audit', x.manager, { entityType: 'allocation' }).expect(200)).body
    .items;
  expect(logs).toHaveLength(1);
  expect(logs[0].actorId).toBe(x.manager.userId);
  expect(logs[0]).not.toHaveProperty('changes');
  expect(
    (
      await list(id, 'audit', x.manager, {
        entityId: logs[0].entityId,
        correlationId: logs[0].correlationId,
      }).expect(200)
    ).body.items,
  ).toEqual(logs);
});
test('same timestamps paginate by UUID without gaps; microseconds survive cursor and JSON', async () => {
  const x = await postedReceiptFixture(app);
  const actor = await identityFixture(app, { warehouseId: x.fixture.warehouse.id, role: 'viewer' });
  const created: string[] = [];
  // Один context даёт всем документам одинаковый now(). Это production create, не переписывание immutable timestamps.
  await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (c) => {
    for (let i = 0; i < 5; i++)
      created.push(
        (
          await app.get(ReceivingService).create(
            c,
            {
              warehouseId: x.fixture.warehouse.id,
              receivingLocationId: x.fixture.receiving.id,
              lines: [{ productId: x.fixture.product.id, quantity: 1 }],
            },
            x.fixture.metadata,
          )
        ).id,
      );
  });
  const seen: string[] = [];
  const times: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await list(x.fixture.warehouse.id, 'receipts', actor, {
      status: 'draft',
      limit: '2',
      ...(cursor ? { cursor } : {}),
    }).expect(200);
    seen.push(...response.body.items.map((r: { id: string }) => r.id));
    times.push(...response.body.items.map((r: { createdAt: string }) => r.createdAt));
    cursor = response.body.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toEqual(created.sort().reverse());
  expect(new Set(times).size).toBe(1);
  expect(times[0]).toMatch(/\.\d{6}Z$/);
  const first = (
    await list(x.fixture.warehouse.id, 'receipts', actor, { status: 'draft', limit: '1' }).expect(
      200,
    )
  ).body;
  const forged = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'));
  forged.time = '0000-01-01T00:00:00.000000Z';
  await list(x.fixture.warehouse.id, 'receipts', actor, {
    status: 'draft',
    cursor: Buffer.from(JSON.stringify(forged)).toString('base64url'),
  }).expect(400);
  await list(x.fixture.warehouse.id, 'receipts', actor, {
    status: 'posted',
    cursor: first.nextCursor,
  }).expect(400);
  await list(x.fixture.warehouse.id, 'putaway-tasks', actor, { cursor: first.nextCursor }).expect(
    400,
  );
});
test.each(resources)(
  '%s requires the actual warehouse role even for empty results; no admin bypass',
  async (resource) => {
    const x = await postedReceiptFixture(app);
    const foreign = await postedReceiptFixture(app);
    const actor = await identityFixture(app, {
      warehouseId: x.fixture.warehouse.id,
      role: 'order_manager',
    });
    const admin = await identityFixture(app, { admin: true });
    await list(foreign.fixture.warehouse.id, resource, actor).expect(403);
    await list(x.fixture.warehouse.id, resource, admin).expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${x.fixture.warehouse.id}/${resource}`)
      .expect(401);
  },
);
test('warehouse lists and audit never include foreign objects; read cannot read audit and revoked grant invalidates cursor', async () => {
  const own = await postedReceiptFixture(app, 10, 3);
  const foreign = await postedReceiptFixture(app);
  const actor = await identityFixture(app, {
    warehouseId: own.fixture.warehouse.id,
    role: 'order_manager',
  });
  const viewer = await identityFixture(app, {
    warehouseId: own.fixture.warehouse.id,
    role: 'viewer',
  });
  await list(own.fixture.warehouse.id, 'audit', viewer).expect(403);
  for (const resource of ['balances', 'movements', 'receipts']) {
    const rows = (await list(own.fixture.warehouse.id, resource, actor).expect(200)).body.items;
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((r: { warehouseId: string }) => r.warehouseId === own.fixture.warehouse.id),
    ).toBe(true);
  }
  expect(
    (
      await list(own.fixture.warehouse.id, 'audit', actor, {
        entityType: 'receipt',
        entityId: foreign.document.id,
      }).expect(200)
    ).body,
  ).toEqual({ items: [], nextCursor: null });
  const first = (
    await list(own.fixture.warehouse.id, 'movements', actor, { limit: '1' }).expect(200)
  ).body;
  expect(first.nextCursor).toEqual(expect.any(String));
  // Прямая SQL смена ACL здесь — fixture административного вмешательства; запрос обязан перечитать grant.
  await db().connection.pool.query('delete from warehouse_roles where user_id=$1', [actor.userId]);
  await list(own.fixture.warehouse.id, 'movements', actor, { cursor: first.nextCursor }).expect(
    403,
  );
});
test('empty result, invalid bounds, repeated filters, unknown fields and injected query never become SQL', async () => {
  const x = await postedReceiptFixture(app);
  const actor = await identityFixture(app, { warehouseId: x.fixture.warehouse.id, role: 'viewer' });
  expect(
    (await list(x.fixture.warehouse.id, 'balances', actor, { productId: randomUUID() }).expect(200))
      .body,
  ).toEqual({ items: [], nextCursor: null });
  for (const query of [
    { limit: '0' },
    { limit: '101' },
    { limit: '1e2' },
    { cursor: '!' },
    { offset: '1' },
    { sort: 'id desc' },
    { productId: "' or true --" },
  ])
    await list(x.fixture.warehouse.id, 'balances', actor, query).expect(400);
  await list(x.fixture.warehouse.id, 'receipts', actor, { status: 'anything' }).expect(400);
  await list(x.fixture.warehouse.id, 'balances', actor, { status: 'posted' }).expect(400);
  await withIdentity(
    request(app.getHttpServer()).get(
      `/api/v1/warehouses/${x.fixture.warehouse.id}/balances?limit=1&limit=2`,
    ),
    actor,
  ).expect(400);
});
test('shipment/picking lists and existing detail API enforce warehouse ACL', async () => {
  const x = await reservedPickingFixture(app, worker, db());
  await warehouseCommand(app, `picking-tasks/${x.task.id}/start`, x.picker).expect(200);
  await warehouseCommand(app, `picking-tasks/${x.task.id}/confirm`, x.picker, {
    taskLineId: x.task.lines[0].id,
    actualQuantity: 10,
    targetLocationId: x.fixture.shipping.id,
    shortage: false,
  }).expect(200);
  const order = (
    await withIdentity(
      request(app.getHttpServer()).get(`/api/v1/orders/${x.order.id}`),
      x.manager,
    ).expect(200)
  ).body;
  const allocation = order.lines[0].allocations.find(
    (a: { locationKind: string }) => a.locationKind === 'shipping',
  );
  const shipment = (
    await warehouseCommand(app, `orders/${x.order.id}/shipments`, x.picker, {
      reasonCode: 'test-dispatch',
      lines: [{ allocationId: allocation.id, quantity: 5 }],
    }).expect(201)
  ).body;
  expect(
    (
      await list(x.fixture.warehouse.id, 'shipments', x.manager, {
        status: 'draft',
        orderId: x.order.id,
      }).expect(200)
    ).body.items[0].id,
  ).toBe(shipment.id);
  expect(
    (
      await list(x.fixture.warehouse.id, 'picking-tasks', x.manager, {
        assigneeId: x.picker.userId,
      }).expect(200)
    ).body.items[0].status,
  ).toBe('completed');
  const stranger = await identityFixture(app);
  const putaway = (
    await db().connection.pool.query('select id from putaway_tasks where source_receipt_id=$1', [
      x.document.id,
    ])
  ).rows[0].id;
  for (const path of [
    `receipts/${x.document.id}`,
    `orders/${x.order.id}`,
    `picking-tasks/${x.task.id}`,
    `shipments/${shipment.id}`,
    `putaway-tasks/${putaway}`,
  ])
    await withIdentity(request(app.getHttpServer()).get(`/api/v1/${path}`), stranger).expect(403);
  const audit = (
    await list(x.fixture.warehouse.id, 'audit', x.manager, {
      entityType: 'shipment',
      entityId: shipment.id,
    }).expect(200)
  ).body.items;
  expect(audit).toHaveLength(1);
  expect(audit[0].action).toContain('shipment');
  // Один субъект имеет grants на оба склада. Это проверяет SQL scope каждого полиморфного вида, а не только 403 guard.
  const foreign = await postedReceiptFixture(app);
  await identityFixture(app, {
    userId: x.manager.userId,
    warehouseId: foreign.fixture.warehouse.id,
    role: 'order_manager',
  });
  const balance = (
    await list(x.fixture.warehouse.id, 'balances', x.manager, {
      locationId: x.fixture.receiving.id,
    }).expect(200)
  ).body.items[0];
  for (const [entityType, entityId] of [
    ['warehouse', x.fixture.warehouse.id],
    ['location', x.fixture.receiving.id],
    ['stock-balance', balance.id],
    ['receipt', x.document.id],
    ['order', x.order.id],
    ['putaway-task', putaway],
    ['picking-task', x.task.id],
    ['shipment', shipment.id],
    [
      'allocation',
      order.lines[0].allocations.find((a: { locationKind: string }) => a.locationKind === 'storage')
        .id,
    ],
  ]) {
    expect(
      (await list(x.fixture.warehouse.id, 'audit', x.manager, { entityType, entityId }).expect(200))
        .body.items.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await list(foreign.fixture.warehouse.id, 'audit', x.manager, {
          entityType,
          entityId,
        }).expect(200)
      ).body,
    ).toEqual({ items: [], nextCursor: null });
  }
});

test('valid cursor scope cannot substitute UUID-only and timestamp SQL key kinds', async () => {
  const { fixture, document } = await postedReceiptFixture(app);
  const actor = await identityFixture(app, { warehouseId: fixture.warehouse.id, role: 'viewer' });
  const scope = { warehouseId: fixture.warehouse.id };
  // Scope и UUID корректны: отказ должен дать именно SQL key contract, а не decoder.
  const receiptCursor = encodePageCursor(preparePageRequest('receipts', scope), {
    id: document.id,
  });
  const productCursor = encodePageCursor(preparePageRequest('products', scope), {
    id: fixture.product.id,
    time: '2026-11-04T10:00:00.123456Z',
  });
  await list(fixture.warehouse.id, 'receipts', actor, { cursor: receiptCursor }).expect(400);
  await list(fixture.warehouse.id, 'products', actor, { cursor: productCursor }).expect(400);
  // Ошибочный cursor не повреждает последующее чтение или session scope.
  const result = await list(fixture.warehouse.id, 'receipts', actor).expect(200);
  expect(result.body.items.map((item: { id: string }) => item.id)).toEqual([document.id]);
});
