/** @file AC-208-03: справочные API действительно ограничивают склады/ячейки, paging и актуальные grants. */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { identityFixture, withIdentity } from '../support/identity.fixture';
const db = useDatabaseSuite();
let app: INestApplication;
beforeAll(async () => {
  app = await db().createHttpApplication();
});
test('readable warehouses never include foreign grants; catalog is organization-wide, locations remain warehouse-scoped', async () => {
  const own = await postedReceiptFixture(app),
    foreign = await postedReceiptFixture(app);
  const viewer = await identityFixture(app, {
      warehouseId: own.fixture.warehouse.id,
      role: 'viewer',
    }),
    admin = await identityFixture(app, { admin: true });
  const read = (path: string) =>
    withIdentity(request(app.getHttpServer()).get('/api/v1/' + path), viewer);
  const warehouses = (await read('warehouses').expect(200)).body;
  expect(warehouses.items.map((w: { id: string }) => w.id)).toEqual([own.fixture.warehouse.id]);
  expect(
    (await withIdentity(request(app.getHttpServer()).get('/api/v1/warehouses'), admin).expect(200))
      .body,
  ).toEqual({ items: [], nextCursor: null });
  const locations = (await read(`warehouses/${own.fixture.warehouse.id}/locations`).expect(200))
    .body.items;
  expect(locations).toHaveLength(3);
  expect(
    locations.every((l: { warehouseId: string }) => l.warehouseId === own.fixture.warehouse.id),
  ).toBe(true);
  const products = (
    await read(`warehouses/${own.fixture.warehouse.id}/products?limit=1`).expect(200)
  ).body;
  expect(products.items).toHaveLength(1);
  expect(products.nextCursor).toEqual(expect.any(String));
  const second = (
    await read(
      `warehouses/${own.fixture.warehouse.id}/products?limit=1&cursor=${products.nextCursor}`,
    ).expect(200)
  ).body;
  expect(second.items).toHaveLength(1);
  expect(second.items[0].id).not.toBe(products.items[0].id);
  for (const resource of ['products', 'locations'])
    await read(`warehouses/${foreign.fixture.warehouse.id}/${resource}`).expect(403);
  await request(app.getHttpServer()).get('/api/v1/warehouses').expect(401);
  await read(`warehouses/${own.fixture.warehouse.id}/locations?limit=101`).expect(400);
  await read(`warehouses/${own.fixture.warehouse.id}/products?sort=sku`).expect(400);
});
test('warehouse cursor is tied to current readable grant set; revoked permission also rejects replay of directory cursor', async () => {
  const a = await postedReceiptFixture(app),
    b = await postedReceiptFixture(app);
  const actor = await identityFixture(app, { warehouseId: a.fixture.warehouse.id, role: 'viewer' });
  await identityFixture(app, {
    userId: actor.userId,
    warehouseId: b.fixture.warehouse.id,
    role: 'order_manager',
  });
  const first = (
    await withIdentity(
      request(app.getHttpServer()).get('/api/v1/warehouses?limit=1'),
      actor,
    ).expect(200)
  ).body;
  expect(first.nextCursor).toEqual(expect.any(String));
  // Администратор временной БД удаляет роль; API обязан перечитать разрешения до складского SELECT.
  await db().connection.pool.query(
    'delete from warehouse_roles where user_id=$1 and warehouse_id=$2',
    [actor.userId, b.fixture.warehouse.id],
  );
  await withIdentity(
    request(app.getHttpServer()).get('/api/v1/warehouses').query({ cursor: first.nextCursor }),
    actor,
  ).expect(400);
  await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/warehouses/${b.fixture.warehouse.id}/products`),
    actor,
  ).expect(403);
});
