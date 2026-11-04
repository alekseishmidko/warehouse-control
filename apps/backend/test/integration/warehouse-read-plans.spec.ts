/** @file WMS-207 EXPLAIN на данных production owners: SQL берётся из реального repository, не из копии запроса. */
import { sql, type SQL } from 'drizzle-orm';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { reservedPickingFixture, warehouseCommand } from '../support/reserved-picking.fixture';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { FulfillmentService } from '@backend/modules/fulfillment/services/fulfillment.service';
import { PickingService } from '@backend/modules/fulfillment/services/picking.service';
import { ShippingService } from '@backend/modules/fulfillment/services/shipping.service';
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';
import { InventoryReadService } from '@backend/modules/inventory/services/inventory-read.service';
import { FulfillmentReadService } from '@backend/modules/fulfillment/services/fulfillment-read.service';
import { ReceivingReadService } from '@backend/modules/receiving/services/receiving-read.service';
import { AuditReadService } from '@backend/modules/audit/services/audit-read.service';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import request, { type Response } from 'supertest';
import { withIdentity, identityFixture } from '../support/identity.fixture';
const db = useDatabaseSuite();
let app: INestApplication, worker: INestApplicationContext;
beforeAll(async () => {
  app = await db().createHttpApplication();
  worker = await db().createWorkerApplication();
});
/** Рекурсивно извлекает узлы плана; PostgreSQL вправе выбирать разные корректные планы для малой таблицы. */
function nodes(plan: Record<string, unknown>): Record<string, unknown>[] {
  return [plan, ...((plan.Plans ?? []) as Record<string, unknown>[]).flatMap(nodes)];
}
test('representative production data: all eight real queries have bounded plans; inspect indexes and continuation pages', async () => {
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const x = await reservedPickingFixture(app, worker, db());
  const id = x.fixture.warehouse.id;
  const orders = app.get(FulfillmentService),
    picking = app.get(PickingService),
    shipping = app.get(ShippingService),
    receiving = app.get(ReceivingService);
  // Сначала освобождаем исходный план через владельца. Следующие планы используют один и тот же физический stock, а не прямой SQL.
  await warehouseCommand(app, `orders/${x.order.id}/cancel`, x.manager).expect(200);
  await runner.run(async (c) => {
    for (let i = 0; i < 100; i++) {
      const o = await orders.create(
        c,
        { warehouseId: id, lines: [{ productId: x.fixture.product.id, quantity: 1 }] },
        x.fixture.metadata,
      );
      await orders.change(c, o.id, 'confirm', undefined, x.fixture.metadata);
      await orders.change(
        c,
        o.id,
        'reserve',
        { lines: [{ lineId: o.lines[0].id, quantity: 1 }] },
        x.fixture.metadata,
      );
      await picking.createTaskFromOrder(c, o.id, x.fixture.metadata);
      await orders.change(c, o.id, 'cancel', undefined, x.fixture.metadata);
    }
    // Данные документов нужны для оценки сортировки и фильтров. Состав создаётся настоящим receiving owner.
    for (let i = 0; i < 500; i++)
      await receiving.create(
        c,
        {
          warehouseId: id,
          receivingLocationId: x.fixture.receiving.id,
          lines: [{ productId: x.fixture.product.id, quantity: 1 }],
        },
        x.fixture.metadata,
      );
  });
  // Два склада по 400 SKU: balances, movements, putaway и audit имеют и целевые, и чужие данные.
  const bulk = await postedReceiptFixture(app, 1, 400);
  await postedReceiptFixture(app, 1, 400);
  for (const claim of await worker.get(WorkerService).claim())
    expect(await worker.get(WorkerService).process(claim)).toBe('completed');
  // Отдельный production staged allocation для большого числа допустимых draft shipments.
  const y = await reservedPickingFixture(app, worker, db());
  await warehouseCommand(app, `picking-tasks/${y.task.id}/start`, y.picker).expect(200);
  await warehouseCommand(app, `picking-tasks/${y.task.id}/confirm`, y.picker, {
    taskLineId: y.task.lines[0].id,
    actualQuantity: 10,
    targetLocationId: y.fixture.shipping.id,
    shortage: false,
  }).expect(200);
  const order = (
    await withIdentity(
      request(app.getHttpServer()).get(`/api/v1/orders/${y.order.id}`),
      y.manager,
    ).expect(200)
  ).body;
  const allocation = order.lines[0].allocations.find(
    (a: { locationKind: string }) => a.locationKind === 'shipping',
  );
  await runner.run(async (c) => {
    for (let i = 0; i < 500; i++)
      await shipping.prepareShipment(
        c,
        y.order.id,
        { reasonCode: 'plan-check', lines: [{ allocationId: allocation.id, quantity: 1 }] },
        y.fixture.metadata,
      );
  });
  await db().connection.pool.query('analyze');
  const inventoryRead = app.get(InventoryReadService),
    fulfillmentRead = app.get(FulfillmentReadService),
    receivingRead = app.get(ReceivingReadService),
    auditRead = app.get(AuditReadService);
  await runner.run(async (c) => {
    const tx = transactionClient(c),
      execute = tx.execute.bind(tx);
    const statements: SQL[] = [];
    // Spy не заменяет PostgreSQL результат. Он сохраняет SQL, который действительно исполняет production repository.
    const spy = jest.spyOn(tx, 'execute').mockImplementation((statement) => {
      statements.push(statement as SQL);
      return execute(statement);
    });
    try {
      await inventoryRead.listBalances(c, bulk.fixture.warehouse.id, {});
      await inventoryRead.listMovements(c, bulk.fixture.warehouse.id, {});
      await inventoryRead.listPutawayTasks(c, bulk.fixture.warehouse.id, {});
      await receivingRead.listReceipts(c, id, {});
      await fulfillmentRead.listOrders(c, id, {});
      await fulfillmentRead.listPickingTasks(c, id, {});
      await fulfillmentRead.listShipments(c, y.fixture.warehouse.id, {});
      await auditRead.listAuditEntries(c, id, {});
    } finally {
      spy.mockRestore();
    }
    expect(statements).toHaveLength(8);
    const names = [
      'balances',
      'movements',
      'putaway',
      'receipts',
      'orders',
      'picking',
      'shipments',
      'audit',
    ];
    for (const [i, statement] of statements.entries()) {
      const result = await execute(sql`explain (analyze,buffers,format json) ${statement}`);
      const data = (result.rows[0]['QUERY PLAN'] as Array<Record<string, unknown>>)[0];
      const plan = data.Plan as Record<string, unknown>;
      const allNodes = nodes(plan);
      expect(plan['Node Type']).toBe('Limit');
      expect(Number(plan['Actual Rows'])).toBeLessThanOrEqual(21);
      // Все восемь планов должны завершаться за уже действующий production statement timeout 5s.
      // Это диагностический локальный набор, не SLO и не запрет Seq Scan для малых таблиц.
      expect(Number(data['Execution Time'])).toBeLessThan(5000);
      console.info(
        'WMS-207 EXPLAIN',
        JSON.stringify({
          resource: names[i],
          rows: plan['Actual Rows'],
          milliseconds: data['Execution Time'],
          indexes: allNodes.flatMap((n) => (n['Index Name'] ? [n['Index Name']] : [])),
          sorts: allNodes
            .filter((n) => n['Node Type'] === 'Sort')
            .map((n) => ({ rows: n['Actual Rows'], method: n['Sort Method'] })),
        }),
      );
    }
  });
  // Для каждой формы SQL проходим несколько страниц на той же production fixture.
  // Проверяем UUID ASC и (timestamp,UUID) DESC, включая множество документов с одинаковым now().
  const bulkActor = await identityFixture(app, {
    warehouseId: bulk.fixture.warehouse.id,
    role: 'order_manager',
  });
  const cases = [
    ...['balances', 'movements', 'putaway-tasks'].map((resource) => ({
      warehouse: bulk.fixture.warehouse.id,
      resource,
      actor: bulkActor,
      count: 400,
    })),
    { warehouse: bulk.fixture.warehouse.id, resource: 'audit', actor: bulkActor, count: 806 },
    { warehouse: id, resource: 'orders', actor: x.manager, count: 101 },
    { warehouse: id, resource: 'picking-tasks', actor: x.manager, count: 101 },
    { warehouse: id, resource: 'receipts', actor: x.manager, count: 501 },
    { warehouse: y.fixture.warehouse.id, resource: 'shipments', actor: y.manager, count: 500 },
  ];
  for (const sample of cases) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response: Response = await withIdentity(
        request(app.getHttpServer())
          .get(`/api/v1/warehouses/${sample.warehouse}/${sample.resource}`)
          .query({ limit: '100', ...(cursor ? { cursor } : {}) }),
        sample.actor,
      ).expect(200);
      ids.push(...response.body.items.map((r: { id: string }) => r.id));
      cursor = response.body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(sample.count);
    expect(new Set(ids).size).toBe(sample.count);
  }
}, 120000);
