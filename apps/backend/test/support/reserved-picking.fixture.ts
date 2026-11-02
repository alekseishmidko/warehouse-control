/** @file Общий test-only сценарий receipt → placement → reserved order → picking plan через production owners и HTTP. */
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import type { DatabaseHarness } from './database-harness';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { postedReceiptFixture } from './posted-receipt.fixture';
import { identityFixture, withIdentity, TestIdentity } from './identity.fixture';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
/** Реальный HTTP-контекст: server session/CSRF/ACL и уникальный idempotency key, без обхода guard. */
export function warehouseCommand(
  app: INestApplication,
  path: string,
  actor: TestIdentity,
  body: object = {},
  key = randomUUID(),
) {
  return withIdentity(request(app.getHttpServer()).post(`/api/v1/${path}`), actor)
    .set('Idempotency-Key', key)
    .send(body);
}
/** Настоящие интерфейсы владельцев; fixture не вычисляет balance/reservation бизнес-правила. */
export async function reservedPickingFixture(
  app: INestApplication,
  worker: INestApplicationContext,
  database: DatabaseHarness,
) {
  const x = await postedReceiptFixture(app, 10);
  const [claim] = await worker.get(WorkerService).claim();
  expect(await worker.get(WorkerService).process(claim)).toBe('completed');
  const task = (
    await database.connection.pool.query(
      'select id from putaway_tasks where source_receipt_id=$1',
      [x.document.id],
    )
  ).rows[0];
  await app
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((c) =>
      app
        .get(InventoryService)
        .executePutawayTask(c, task.id, x.fixture.storage.id, x.fixture.metadata),
    );
  const manager = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'order_manager',
  });
  const picker = await identityFixture(app, {
    warehouseId: x.fixture.warehouse.id,
    role: 'warehouse_operator',
  });
  const o = await warehouseCommand(app, 'orders', manager, {
    warehouseId: x.fixture.warehouse.id,
    lines: [{ productId: x.fixture.product.id, quantity: 10 }],
  }).expect(201);
  await warehouseCommand(app, `orders/${o.body.id}/confirm`, manager).expect(200);
  await warehouseCommand(app, `orders/${o.body.id}/reserve`, manager, {
    lines: [{ lineId: o.body.lines[0].id, quantity: 10 }],
  }).expect(200);
  const p = await warehouseCommand(app, `orders/${o.body.id}/picking-tasks`, manager).expect(201);
  return { ...x, manager, picker, order: o.body, task: p.body };
}
