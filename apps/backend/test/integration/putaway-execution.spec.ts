/** @file WMS-203: реальные migrations/HTTP/worker/row locks, парный перенос, отсутствие дублирования и rollback каждого существенного шага. */
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { useDatabaseSuite } from '../support/database-harness';
import { waitForDatabaseLock } from '../support/database-lock';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { identityFixture, withIdentity, TestIdentity } from '../support/identity.fixture';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import { ReceivingService } from '@backend/modules/receiving/services/receiving.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { sql } from 'drizzle-orm';
const database = useDatabaseSuite();
let api: INestApplication;
let workerApp: INestApplicationContext;
beforeAll(async () => {
  api = await database().createHttpApplication();
  workerApp = await database().createWorkerApplication();
});
/** Готовит настоящую posted receipt и durable task через production worker; прямого SQL начисления/создания tasks нет. */
async function setup(quantity = 10) {
  const result = await postedReceiptFixture(api, quantity);
  const worker = workerApp.get(WorkerService);
  const [claim] = await worker.claim();
  expect(await worker.process(claim)).toBe('completed');
  const task = (
    await database().connection.pool.query(
      'select id from putaway_tasks where source_receipt_id=$1',
      [result.document.id],
    )
  ).rows[0];
  const actor = await identityFixture(api, { warehouseId: result.fixture.warehouse.id });
  return { ...result, taskId: task.id as string, actor };
}
/** Browser command использует реальный guard/DTO/authorization/idempotency, без bypass. */
function execute(
  taskId: string,
  targetLocationId: string,
  actor: TestIdentity,
  key = randomUUID(),
) {
  return withIdentity(
    request(api.getHttpServer()).post(`/api/v1/putaway-tasks/${taskId}/execute`),
    actor,
  )
    .set('Idempotency-Key', key)
    .send({ targetLocationId });
}
/** Снимок invariant до/после fault: target row, balances, task, movements, audit/event/dedup должны откатиться вместе. */
async function evidence() {
  const pool = database().connection.pool;
  return {
    balances: (
      await pool.query(
        'select location_id,on_hand,reserved from stock_balances order by location_id',
      )
    ).rows,
    tasks: (
      await pool.query(
        'select id,status,target_location_id,completed_event_id,completion_audit_id from putaway_tasks order by id',
      )
    ).rows,
    movements: (await pool.query('select count(*)::int n from stock_movements')).rows[0].n,
    audit: (await pool.query('select count(*)::int n from audit_entries')).rows[0].n,
    events: (await pool.query('select count(*)::int n from outbox_events')).rows[0].n,
    commands: (await pool.query('select count(*)::int n from http_idempotency')).rows[0].n,
  };
}

/** Одна task → пара movements с одинаковым transferId, один completion event, total stock прежний. */
test('execute moves full quantity and persists task/audit/event atomically; replay is stable and worker redelivery does not re-credit', async () => {
  const { fixture, taskId, actor, document } = await setup();
  const key = randomUUID();
  const first = await execute(taskId, fixture.storage.id, actor, key).expect(200);
  expect(first.body).toMatchObject({
    id: taskId,
    status: 'completed',
    quantity: 10,
    targetLocationId: fixture.storage.id,
  });
  expect(
    (
      await database().connection.pool.query(
        'select on_hand from stock_balances where location_id=$1',
        [fixture.receiving.id],
      )
    ).rows[0].on_hand,
  ).toBe(0);
  expect(
    (
      await database().connection.pool.query(
        'select on_hand,reserved from stock_balances where location_id=$1',
        [fixture.storage.id],
      )
    ).rows[0],
  ).toEqual({ on_hand: 10, reserved: 0 });
  const moves = (
    await database().connection.pool.query(
      'select kind,quantity,transfer_id,audit_id from stock_movements where transfer_id=$1 order by kind',
      [taskId],
    )
  ).rows;
  expect(moves).toEqual(
    ['transfer-in', 'transfer-out'].map((kind) => ({
      kind,
      quantity: 10,
      transfer_id: taskId,
      audit_id: first.body.completionAuditId,
    })),
  );
  const event = (
    await database().connection.pool.query('select envelope from outbox_events where event_id=$1', [
      first.body.completedEventId,
    ])
  ).rows[0].envelope;
  expect(event).toMatchObject({
    type: 'inventory.putaway-completed',
    aggregateType: 'putaway-task',
    aggregateId: taskId,
    aggregateVersion: 1,
    occurredAt: first.body.completedAt,
    causationId: document.postedEventId,
    payload: { taskId, transferId: taskId, quantity: 10, targetLocationId: fixture.storage.id },
  });
  expect(
    (
      await database().connection.pool.query(
        'select count(*)::int n from outbox_deliveries where event_id=$1',
        [first.body.completedEventId],
      )
    ).rows[0].n,
  ).toBe(0);
  const snapshot = await evidence();
  expect((await execute(taskId, fixture.storage.id, actor, key).expect(200)).body).toEqual(
    first.body,
  );
  expect(await evidence()).toEqual(snapshot);
  await execute(taskId, fixture.storage.id, actor).expect(409);
  await execute(taskId, fixture.shipping.id, actor, key).expect(409);
  // Прямой identical create repeat после execution возвращает существующую completed task, не новый stock credit.
  const source = (
    await database().connection.pool.query('select envelope from outbox_events where event_id=$1', [
      document.postedEventId,
    ])
  ).rows[0].envelope;
  await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((context) =>
      api.get(InventoryService).createPutawayTasks(context, { ...fixture.metadata, event: source }),
    );
  expect(await evidence()).toEqual(snapshot);
  await withIdentity(
    request(api.getHttpServer()).get(`/api/v1/putaway-tasks/${taskId}`),
    actor,
  ).expect(200);
});

/** Несовпадающие key не обходят task lock; две сессии исключают сериализацию только на guard idle touch. */
test.each([false, true])(
  'concurrent execution of one task respects identicalKey=%s',
  async (identicalKey) => {
    const { fixture, taskId, actor } = await setup();
    const second = await identityFixture(api, { userId: actor.userId });
    const key = randomUUID();
    const results = await Promise.all([
      execute(taskId, fixture.storage.id, actor, key),
      execute(taskId, fixture.storage.id, second, identicalKey ? key : randomUUID()),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual(identicalKey ? [200, 200] : [200, 409]);
    if (identicalKey) expect(results[1].body).toEqual(results[0].body);
    expect(
      (
        await database().connection.pool.query(
          'select count(*)::int n from stock_movements where transfer_id=$1',
          [taskId],
        )
      ).rows[0].n,
    ).toBe(2);
  },
);

/** Две реальные task одного продукта/источника/нового назначения проверяют unique absent-key race и отсутствие lost updates. */
test('different tasks concurrently create one destination balance and preserve quantity', async () => {
  const { fixture, taskId, actor } = await setup();
  const secondDocument = await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run(async (context) => {
      const receiving = api.get(ReceivingService);
      const draft = await receiving.create(
        context,
        {
          warehouseId: fixture.warehouse.id,
          receivingLocationId: fixture.receiving.id,
          lines: [{ productId: fixture.product.id, quantity: 7 }],
        },
        fixture.metadata,
      );
      return receiving.post(context, draft.id, fixture.metadata);
    });
  const worker = workerApp.get(WorkerService);
  const [claim] = await worker.claim();
  expect(await worker.process(claim)).toBe('completed');
  const otherTask = (
    await database().connection.pool.query(
      'select id from putaway_tasks where source_receipt_id=$1',
      [secondDocument.id],
    )
  ).rows[0].id;
  const second = await identityFixture(api, { userId: actor.userId });
  const blocker = await database().connection.pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from stock_balances where location_id=$1 for update', [
    fixture.receiving.id,
  ]);
  // Два отдельных session token не сериализуют callers в guard. Удерживаем source до наблюдения
  // обоих DB waits: один caller может ждать unique INSERT нового target, другой — source row lock.
  const pending = [
    execute(taskId, fixture.storage.id, actor).then((r) => r),
    execute(otherTask, fixture.storage.id, second).then((r) => r),
  ];
  try {
    await waitForDatabaseLock(database(), 'stock_balances', 2);
    await blocker.query('commit');
    expect((await Promise.all(pending)).map((x) => x.status)).toEqual([200, 200]);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await Promise.allSettled(pending);
  }
  expect(
    (
      await database().connection.pool.query(
        'select on_hand,reserved from stock_balances where location_id=$1',
        [fixture.storage.id],
      )
    ).rows,
  ).toEqual([{ on_hand: 17, reserved: 0 }]);
  expect(
    (await database().connection.pool.query('select sum(on_hand)::int n from stock_balances'))
      .rows[0].n,
  ).toBe(17);
});

/** Только синтетическое нарушение физического остатка через SQL: endpoint не предоставляет inventory correction API. */
test.each(['empty', 'short', 'reserved', 'overflow'])(
  'rejects %s source/target without partial effects',
  async (scenario) => {
    const { fixture, taskId, actor } = await setup();
    const pool = database().connection.pool;
    if (scenario === 'empty') {
      // FK movement → balance не разрешает удалить источник: моделируем отсутствующий доступный stock нулём.
      await pool.query('update stock_balances set on_hand=0');
    } else if (scenario === 'short') await pool.query('update stock_balances set on_hand=9');
    else if (scenario === 'reserved') await pool.query('update stock_balances set reserved=1');
    else
      await pool.query(
        'insert into stock_balances(warehouse_id,location_id,product_id,on_hand) values($1,$2,$3,2147483647)',
        [fixture.warehouse.id, fixture.storage.id, fixture.product.id],
      );
    const before = await evidence();
    const result = await execute(taskId, fixture.storage.id, actor).expect(
      scenario === 'overflow' ? 422 : 409,
    );
    expect(result.body.code).toBe(
      scenario === 'overflow' ? 'STOCK_LIMIT_EXCEEDED' : 'INSUFFICIENT_STOCK',
    );
    expect(await evidence()).toEqual(before);
  },
);

/** Зоны и принадлежность проверяются владельцем warehouses; ни source, ни actor клиент не выбирает. */
test('rejects receiving/shipping/self and foreign warehouse target; denies viewers and replay after role revoke', async () => {
  const { fixture, taskId, actor } = await setup();
  for (const target of [fixture.receiving.id, fixture.shipping.id])
    await execute(taskId, target, actor).expect(422);
  const foreign = await postedReceiptFixture(api);
  await execute(taskId, foreign.fixture.storage.id, actor).expect(422);
  const viewer = await identityFixture(api, { warehouseId: fixture.warehouse.id, role: 'viewer' });
  await withIdentity(
    request(api.getHttpServer()).get(`/api/v1/putaway-tasks/${taskId}`),
    viewer,
  ).expect(200);
  await execute(taskId, fixture.storage.id, viewer).expect(403);
  const outsider = await identityFixture(api);
  await withIdentity(
    request(api.getHttpServer()).get(`/api/v1/putaway-tasks/${taskId}`),
    outsider,
  ).expect(403);
  const key = randomUUID();
  await execute(taskId, fixture.storage.id, actor, key).expect(200);
  await database().connection.pool.query('delete from warehouse_roles where user_id=$1', [
    actor.userId,
  ]);
  await execute(taskId, fixture.storage.id, actor, key).expect(403);
});

/** AFTER faults гарантируют, что SQL изменение уже произошло; общий rollback проверяет каждую границу сценария. */
test.each(['debit', 'credit', 'audit', 'movement', 'event', 'task'])(
  'rolls back all state after %s fault and same-key retry succeeds',
  async (stage) => {
    const { fixture, taskId, actor } = await setup();
    const pool = database().connection.pool;
    const key = randomUUID();
    const before = await evidence();
    const table = {
      debit: 'stock_balances',
      credit: 'stock_balances',
      audit: 'audit_entries',
      movement: 'stock_movements',
      event: 'outbox_events',
      task: 'putaway_tasks',
    }[stage]!;
    const action =
      stage === 'debit' || stage === 'credit' || stage === 'task' ? 'update' : 'insert';
    const condition =
      stage === 'debit'
        ? `new.location_id='${fixture.receiving.id}'`
        : stage === 'credit'
          ? `new.location_id='${fixture.storage.id}'`
          : 'true';
    // table/action выбираются закрытым test enum, UUID берутся из fixture, не из внешнего input.
    await pool.query(
      `create function execution_fault() returns trigger language plpgsql as $$ begin if ${condition} then raise exception 'injected'; end if; return new; end $$`,
    );
    try {
      await pool.query(
        `create trigger execution_fault after ${action} on ${table} for each row execute function execution_fault()`,
      );
      try {
        await execute(taskId, fixture.storage.id, actor, key).expect(500);
      } finally {
        await pool.query(`drop trigger execution_fault on ${table}`);
      }
    } finally {
      await pool.query('drop function execution_fault()');
    }
    expect(await evidence()).toEqual(before);
    await execute(taskId, fixture.storage.id, actor, key).expect(200);
  },
);

/** Runtime role обязана выполнять новый сценарий с column grants; source/retention guards сохраняются. */
test('warehouse_app executes completion and cannot mutate completed task or movement pair', async () => {
  const { fixture, taskId } = await setup();
  const runner = api.get<TransactionRunner>(TRANSACTION_RUNNER);
  await runner.run(async (context) => {
    await transactionClient(context).execute(sql`set local role warehouse_app`);
    await api
      .get(InventoryService)
      .executePutawayTask(context, taskId, fixture.storage.id, fixture.metadata);
  });
  await expect(
    database().connection.pool.query("update putaway_tasks set status='pending' where id=$1", [
      taskId,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    database().connection.pool.query('delete from stock_movements where transfer_id=$1', [taskId]),
  ).rejects.toMatchObject({ code: '42501' });
});

/** DTO/guard дают безопасные отказы, неизвестный task не создаёт stock/audit. */
test('validates command and task existence through public HTTP', async () => {
  const { fixture, taskId, actor } = await setup();
  await request(api.getHttpServer())
    .post(`/api/v1/putaway-tasks/${taskId}/execute`)
    .send({ targetLocationId: fixture.storage.id })
    .expect(401);
  await execute(randomUUID(), fixture.storage.id, actor).expect(404);
  await withIdentity(
    request(api.getHttpServer()).post(`/api/v1/putaway-tasks/${taskId}/execute`),
    actor,
  )
    .set('Idempotency-Key', randomUUID())
    .send({ targetLocationId: fixture.storage.id, quantity: 1 })
    .expect(400);
  await execute(taskId, 'bad', actor).expect(400);
});

/** Резерв остаётся в source: разрешён перенос только свободной части, не migration allocation в target. */
test('moving free stock preserves reserved quantity at source', async () => {
  const { fixture, taskId, actor } = await setup();
  await api.get<TransactionRunner>(TRANSACTION_RUNNER).run((context) =>
    api.get(InventoryService).receive(context, {
      ...fixture.metadata,
      warehouseId: fixture.warehouse.id,
      locationId: fixture.receiving.id,
      productId: fixture.product.id,
      quantity: 1,
      operationId: randomUUID(),
    }),
  );
  await database().connection.pool.query(
    'update stock_balances set reserved=1 where location_id=$1',
    [fixture.receiving.id],
  );
  await execute(taskId, fixture.storage.id, actor).expect(200);
  expect(
    (
      await database().connection.pool.query(
        'select on_hand,reserved from stock_balances where location_id=$1',
        [fixture.receiving.id],
      )
    ).rows[0],
  ).toEqual({ on_hand: 1, reserved: 1 });
  expect(
    (
      await database().connection.pool.query(
        'select on_hand,reserved from stock_balances where location_id=$1',
        [fixture.storage.id],
      )
    ).rows[0],
  ).toEqual({ on_hand: 10, reserved: 0 });
});

/** Direct SQL допускается только для проверки constraint: половина пары не может пережить COMMIT. */
test('deferred constraint rejects orphan movement without completed task', async () => {
  const { fixture, taskId } = await setup();
  const before = await evidence();
  await expect(
    api.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (context) => {
      await transactionClient(context)
        .execute(sql`insert into stock_movements(operation_id,warehouse_id,location_id,product_id,quantity,kind,transfer_id,audit_id)
   select ${randomUUID()},warehouse_id,source_location_id,product_id,quantity,'transfer-out',id,audit_id from putaway_tasks where id=${taskId}`);
    }),
  ).rejects.toThrow();
  expect(await evidence()).toEqual(before);
});
