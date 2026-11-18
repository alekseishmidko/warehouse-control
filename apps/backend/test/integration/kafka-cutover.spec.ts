/** @file WMS-506: репетиция DB worker → Kafka → DB worker, backup и складские инварианты.
 * Требует реальные PostgreSQL migrations, mTLS Kafka и Docker. Только disposable данные;
 * API закрывается на boundary, production handlers не заменяются technical заглушками.
 */
import type { INestApplication } from '@nestjs/common';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { useDatabaseSuite } from '../support/database-harness';
import { createKafkaFixture } from '../support/kafka.fixture';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { identityFixture, withIdentity } from '../support/identity.fixture';
import { warehouseCommand } from '../support/reserved-picking.fixture';
import {
  assertSafeBoundary,
  captureTransportBoundary,
  observeCutover,
  verifyCutoverBackup,
  setCutoverBrokerPaused,
} from '../support/cutover.fixture';
import { PublisherRepository } from '@backend/infrastructure/publisher/repositories/publisher.repository';
import { PublisherService } from '@backend/infrastructure/publisher/services/publisher.service';
import { KafkaEventTransport } from '@backend/infrastructure/publisher/kafka-event.transport';
import { KafkaApplicationConsumer } from '@backend/infrastructure/kafka-consumer/kafka-consumer';
import { KafkaConsumerModule } from '@backend/infrastructure/kafka-consumer/kafka-consumer.module';
import { KafkaMessageService } from '@backend/infrastructure/kafka-consumer/services/kafka-message.service';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import type { KnownEvent } from '@backend/shared/events/dto/event.dto';
import { kafkaRoute } from '@backend/shared/events/kafka-route';

jest.setTimeout(180000);
const database = useDatabaseSuite();
let broker: Awaited<ReturnType<typeof createKafkaFixture>>;
beforeAll(async () => {
  broker = await createKafkaFixture();
});
afterAll(async () => {
  await broker?.dispose();
});

/** SQL snapshot не сохраняет envelope. Каждая phase проверяет независимые стороны учёта. */
async function boundary() {
  return captureTransportBoundary(database().connection.pool);
}
/** Настоящий production worker lifecycle в существующем child fixture: port0 не занимает dev9100.
 * IPC только снимает test barrier внутри настоящего InventoryService, не заменяет его эффект.
 * Exit0 проверяется после SIGTERM; никакой forceExit/fallback на ручной process(claim).
 */
function startLocalWorker() {
  const child = fork(resolve('.test-dist/test/support/worker-process.fixture.js'), [], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      DATABASE_URL: database().config.databaseUrl,
      TEST_PUTAWAY_HANDLER: 'true',
      WORKER_POLL_INTERVAL_MS: '20',
      LOG_LEVEL: 'fatal',
      OTEL_SDK_DISABLED: 'true',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  // Сразу подписываем exit: быстрое завершение между observation и stop не теряет событие.
  const exited = once(child, 'exit');
  exited.catch(() => {}); // Startup error будет передан stopLocalWorker, без unhandled rejection до cleanup.
  child.on('message', (message) => {
    if (message === 'handling' && child.connected) child.send('release');
  });
  // Поток дренируется, но driver/runtime text не попадает в committed report.
  child.stderr?.resume();
  return { child, exited };
}
/** При ошибке теста всё равно останавливает только принадлежащий тесту child. */
async function stopLocalWorker(worker: ReturnType<typeof startLocalWorker>): Promise<void> {
  if (worker.child.exitCode === null && worker.child.signalCode === null)
    worker.child.kill('SIGTERM');
  const [code, signal] = await worker.exited;
  expect({ code, signal }).toEqual({ code: 0, signal: null });
}
/** Один publisher session owner. Kafka подключается после DB singleton, закрывается до его release. */
async function startPublisher() {
  const repository = await PublisherRepository.acquire(database().connection.pool);
  const transport = new KafkaEventTransport(broker.config);
  try {
    await transport.connect();
  } catch (error) {
    try {
      await transport.close();
    } finally {
      repository.close();
    }
    throw error;
  }
  return {
    service: new PublisherService(repository, transport),
    async close() {
      try {
        await transport.close();
      } finally {
        repository.close();
      }
    },
  };
}
/** Polling publisher idle недостаточен: retry может ещё ждать available_at. Проверяем все retained events. */
async function drainPublisher(publisher: Awaited<ReturnType<typeof startPublisher>>) {
  await observeCutover(async () => {
    expect(await publisher.service.tick()).not.toBe('dead');
    const result = await database().connection.pool.query<{ pending: number }>(`
      select count(*)::int pending from outbox_events e where not exists(
        select 1 from outbox_deliveries d where d.event_id=e.event_id
          and d.destination='kafka.publish' and d.status='completed')`);
    return result.rows[0].pending === 0;
  });
}
/** Снимок broker addresses не смешивается с aggregateVersion. Kafka offsets остаются decimal strings. */
async function brokerBoundary() {
  const admin = broker.kafka.admin();
  try {
    await admin.connect();
    return {
      topic: await admin.fetchTopicOffsets('warehouse.receiving.events'),
      groups: await admin.fetchOffsets({
        groupId: 'inventory.putaway',
        topics: ['warehouse.receiving.events'],
      }),
    };
  } finally {
    await admin.disconnect();
  }
}
/** Только текущая suite: отсутствие marker проверяется для каждого retained receipt event, не по общему RPS. */
async function waitForEffects() {
  await observeCutover(async () => (await boundary()).pendingEffects.length === 0);
}
/** Закрывает реальный listener и graph; отказ нового соединения доказывает freeze сетевого входа.
 * В disposable stand других writers нет. Внешний стенд требует остановить также CLI/import jobs.
 */
async function freezeApi(api: INestApplication) {
  const url = await api.getUrl();
  await api.close();
  await expect(fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
}
/** Открывает consumer без local WorkerLoop. Запись HTTP остаётся закрытой до явного api.listen ниже. */
async function startConsumer(api: INestApplication) {
  const consumer = new KafkaApplicationConsumer(
    {
      brokers: broker.config.brokers,
      ssl: broker.config.ssl,
      transactionTimeoutMs: 10000,
      shutdownMs: 20000,
      healthPort: 9102,
    },
    api.get(KafkaMessageService),
  );
  try {
    await consumer.start();
  } catch (error) {
    await consumer.close();
    throw error;
  }
  return consumer;
}

/** HTTP приёмка создаёт refs отдельно через owners, затем соблюдает настоящий session/CSRF/warehouse ACL. */
async function receiveThroughHttp(api: INestApplication) {
  const refs = await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((c) => createDevWarehouseFixtures(c, api.get(CatalogService), api.get(WarehousesService)));
  const operator = await identityFixture(api, { warehouseId: refs.warehouse.id });
  const receipt = await warehouseCommand(api, 'receipts', operator, {
    warehouseId: refs.warehouse.id,
    receivingLocationId: refs.receiving.id,
    lines: [{ productId: refs.product.id, quantity: 10 }],
  }).expect(201);
  const key = randomUUID();
  const posted = await warehouseCommand(
    api,
    `receipts/${receipt.body.id}/post`,
    operator,
    {},
    key,
  ).expect(200);
  // Saved HTTP result replay не создаёт второй outbox факт даже при неизвестном исходе для клиента.
  expect(
    (await warehouseCommand(api, `receipts/${receipt.body.id}/post`, operator, {}, key).expect(200))
      .body,
  ).toEqual(posted.body);
  return { refs, operator, receiptId: String(receipt.body.id) };
}
/** Проводит размещение → резерв → частичную сборку/отгрузку → отмену/возврат через HTTP.
 * Никакой helper не запускает local worker: pending task создаёт только Kafka consumer.
 */
async function completeWarehouseFlow(
  api: INestApplication,
  receipt: Awaited<ReturnType<typeof receiveThroughHttp>>,
) {
  const { refs, operator, receiptId } = receipt;
  const task = (
    await database().connection.pool.query<{ id: string }>(
      'select id from putaway_tasks where source_receipt_id=$1',
      [receiptId],
    )
  ).rows[0];
  await warehouseCommand(api, `putaway-tasks/${task.id}/execute`, operator, {
    targetLocationId: refs.storage.id,
  }).expect(200);
  const manager = await identityFixture(api, {
    warehouseId: refs.warehouse.id,
    role: 'order_manager',
  });
  const order = (
    await warehouseCommand(api, 'orders', manager, {
      warehouseId: refs.warehouse.id,
      lines: [{ productId: refs.product.id, quantity: 10 }],
    }).expect(201)
  ).body;
  await warehouseCommand(api, `orders/${order.id}/confirm`, manager).expect(200);
  await warehouseCommand(api, `orders/${order.id}/reserve`, manager, {
    lines: [{ lineId: order.lines[0].id, quantity: 10 }],
  }).expect(200);
  const picking = (
    await warehouseCommand(api, `orders/${order.id}/picking-tasks`, manager).expect(201)
  ).body;
  await warehouseCommand(api, `picking-tasks/${picking.id}/start`, operator).expect(200);
  await warehouseCommand(api, `picking-tasks/${picking.id}/confirm`, operator, {
    taskLineId: picking.lines[0].id,
    actualQuantity: 6,
    targetLocationId: refs.shipping.id,
    shortage: false,
  }).expect(200);
  const read = async () =>
    (
      await withIdentity(
        request(api.getHttpServer()).get(`/api/v1/orders/${order.id}`),
        manager,
      ).expect(200)
    ).body;
  const allocation = (await read()).lines[0].allocations.find(
    (a: { locationKind: string }) => a.locationKind === 'shipping',
  );
  const shipment = (
    await warehouseCommand(api, `orders/${order.id}/shipments`, operator, {
      reasonCode: 'cutover-drill',
      lines: [{ allocationId: allocation.id, quantity: 4 }],
    }).expect(201)
  ).body;
  await warehouseCommand(api, `shipments/${shipment.id}/post`, operator).expect(200);
  await warehouseCommand(api, `orders/${order.id}/cancel`, manager).expect(200);
  await warehouseCommand(api, `orders/${order.id}/cancellation-return`, operator, {
    reasonCode: 'cutover-drill',
    lines: [{ lineId: order.lines[0].id, quantity: 2, targetLocationId: refs.storage.id }],
  }).expect(200);
  expect(await read()).toMatchObject({
    status: 'closed_mixed',
    lines: [
      expect.objectContaining({
        shipped: 4,
        cancelled: 6,
        reservedShipping: 0,
        reservedStorage: 0,
      }),
    ],
  });
  assertSafeBoundary(await boundary());
}

test('506 backup and bidirectional cutover', async () => {
  let api: INestApplication | undefined;
  let local: ReturnType<typeof startLocalWorker> | undefined;
  let publisher: Awaited<ReturnType<typeof startPublisher>> | undefined;
  let consumer: KafkaApplicationConsumer | undefined;
  let paused = false;
  const startedAt = new Date().toISOString();
  try {
    api = await database().createHttpApplication();
    await api.listen(0, '127.0.0.1');
    await postedReceiptFixture(api);
    local = startLocalWorker();
    await waitForEffects();
    await stopLocalWorker(local);
    local = undefined;
    const localCompleted = await boundary();
    const pending = await postedReceiptFixture(api);
    await freezeApi(api);
    api = undefined;
    const forward = await boundary();
    assertSafeBoundary(forward);
    expect(forward.pendingEffects).toHaveLength(1);
    expect(forward.streams.find((s) => s.aggregateId === pending.document.id)?.consumerCursor).toBe(
      '0',
    );
    expect(forward.markers).toEqual(localCompleted.markers);
    const backup = await verifyCutoverBackup(database());
    expect(backup.boundary).toEqual(forward);

    api = await database().createHttpApplication({ imports: [KafkaConsumerModule] });
    consumer = await startConsumer(api);
    publisher = await startPublisher();
    await expect(PublisherRepository.acquire(database().connection.pool)).rejects.toThrow(
      'singleton',
    );
    await drainPublisher(publisher);
    await waitForEffects();
    const drained = await boundary();
    assertSafeBoundary(drained);
    expect(drained.inventory.taskCount - forward.inventory.taskCount).toBe(
      forward.pendingEffects.length,
    );
    expect(drained.inventory.balances).toBe(forward.inventory.balances);
    expect(drained.inventory.movements).toBe(forward.inventory.movements);
    expect(drained.markers).toEqual(expect.arrayContaining(forward.markers));
    expect(drained.events).toEqual(forward.events);
    expect(drained.deliveries.filter((d) => d.destination === 'inventory.putaway')).toEqual(
      forward.deliveries.filter((d) => d.destination === 'inventory.putaway'),
    );
    const forwardOffsets = await brokerBoundary();

    // HTTP открывается только после сверки frozen backlog, затем выполняется полный business flow.
    await api.listen(0, '127.0.0.1');
    const receipt = await receiveThroughHttp(api);
    await drainPublisher(publisher);
    await waitForEffects();
    await completeWarehouseFlow(api, receipt);
    await drainPublisher(publisher);
    const beforeDuplicate = await boundary();
    const event = (
      await database().connection.pool.query<{ envelope: KnownEvent }>(
        "select envelope from outbox_events where aggregate_id=$1 and aggregate_type='receipt'",
        [receipt.receiptId],
      )
    ).rows[0].envelope;
    const route = kafkaRoute(event);
    const producer = broker.kafka.producer();
    try {
      await producer.connect();
      const [published] = await producer.send({
        topic: route.topic,
        acks: -1,
        messages: [
          {
            key: route.key,
            partition: route.partition,
            value: JSON.stringify(event),
            headers: {
              'content-type': 'application/json',
              'x-event-type': event.type,
              'x-schema-version': String(event.schemaVersion),
            },
          },
        ],
      });
      const baseOffset = published.baseOffset;
      if (baseOffset === undefined) throw new Error('Broker did not acknowledge duplicate offset');
      await observeCutover(async () => {
        const offsets = await brokerBoundary();
        const committed = offsets.groups[0].partitions.find(
          (p) => p.partition === route.partition,
        )!.offset;
        return BigInt(committed) > BigInt(baseOffset);
      });
    } finally {
      await producer.disconnect();
    }
    expect(await boundary()).toEqual(beforeDuplicate);

    // Broker outage происходит после закрытия consumer: restore начинается новым owner,
    // а не переиспользованием fail-stop SDK. Business commit по-прежнему не вызывает Kafka.
    await consumer.close();
    consumer = undefined;
    await setCutoverBrokerPaused(broker.container.getId(), true);
    paused = true;
    const outageReceipt = await receiveThroughHttp(api);
    await expect(publisher.service.tick()).rejects.toThrow('uncertain');
    const outage = await boundary();
    expect(outage.pendingEffects).toHaveLength(1);
    expect(outage.inventory.onHand).toBe(beforeDuplicate.inventory.onHand + 10);
    await setCutoverBrokerPaused(broker.container.getId(), false);
    paused = false;
    await publisher.close();
    publisher = undefined;
    publisher = await startPublisher();
    consumer = await startConsumer(api);
    await drainPublisher(publisher);
    await waitForEffects();
    expect((await boundary()).inventory.taskCount).toBe(outage.inventory.taskCount + 1);

    // Новый boundary ПОСЛЕ Kafka effects. Здесь специально оставлена новая pending приёмка:
    // reverse должен и догнать Kafka markers, и выполнить ещё не применённый business effect.
    await consumer.close();
    consumer = undefined;
    await publisher.close();
    publisher = undefined;
    const reversePending = await receiveThroughHttp(api);
    await freezeApi(api);
    api = undefined;
    const reverse = await boundary();
    const reverseOffsets = await brokerBoundary();
    assertSafeBoundary(reverse);
    expect(reverse.pendingEffects).toHaveLength(1);
    expect(reverse.markers.length).toBeGreaterThan(forward.markers.length);
    expect(reverse.events.length).toBeGreaterThan(forward.events.length);
    const reverseBackup = await verifyCutoverBackup(database());
    expect(reverseBackup.boundary).toEqual(reverse);
    local = startLocalWorker();
    await observeCutover(async () => (await boundary()).localPending.length === 0);
    await stopLocalWorker(local);
    local = undefined;
    const returned = await boundary();
    assertSafeBoundary(returned);
    expect(returned.pendingEffects).toEqual([]);
    expect(returned.markers).toEqual(expect.arrayContaining(reverse.markers));
    expect(returned.markers).toHaveLength(reverse.markers.length + 1);
    expect(returned.events).toEqual(reverse.events);
    expect(returned.inventory.taskCount).toBe(reverse.inventory.taskCount + 1);
    expect(returned.inventory.balances).toBe(reverse.inventory.balances);
    expect(returned.inventory.movements).toBe(reverse.inventory.movements);
    expect(returned.streams.every((s) => s.localCursor === s.consumerCursor)).toBe(true);
    expect(
      returned.streams.find((s) => s.aggregateId === reversePending.receiptId)?.consumerCursor,
    ).toBe('1');
    expect(
      returned.streams.find((s) => s.aggregateId === outageReceipt.receiptId)?.consumerCursor,
    ).toBe('1');
    // Возврат завершён, можно снова открыть HTTP. Старый backup в исходную БД не restore-ится.
    api = await database().createHttpApplication();
    await api.listen(0, '127.0.0.1');
    await request(api.getHttpServer()).get('/health').expect(200);
    await freezeApi(api);
    api = undefined;

    const directory = resolve('../../artifacts/cutover');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(directory, `${randomUUID()}.json`),
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          node: process.version,
          backup: { sha256: backup.sha256, bytes: backup.bytes },
          reverseBackup: { sha256: reverseBackup.sha256, bytes: reverseBackup.bytes },
          forward,
          forwardOffsets,
          drained,
          outage,
          reverse,
          reverseOffsets,
          returned,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    // Нельзя оставить broker paused: его dispose и SDK close должны завершаться штатно.
    if (paused) await setCutoverBrokerPaused(broker.container.getId(), false);
    const cleanups: Array<() => Promise<unknown>> = [
      () => api?.close() ?? Promise.resolve(),
      () => (local ? stopLocalWorker(local) : Promise.resolve()),
      () => publisher?.close() ?? Promise.resolve(),
      () => consumer?.close() ?? Promise.resolve(),
    ];
    let cleanupFailed = false;
    for (const close of cleanups.reverse()) {
      try {
        await close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) throw new Error('Cutover cleanup failed');
  }
});

test('506 boundary rejects an active claim before transfer', async () => {
  const api = await database().createHttpApplication();
  await postedReceiptFixture(api);
  const local = await database().createWorkerApplication();
  const [claim] = await local.get(WorkerService).claim();
  const claimed = await boundary();
  expect(claimed.checks.activeLeases).toBeGreaterThan(0);
  expect(() => assertSafeBoundary(claimed)).toThrow('activeLeases');
  expect(claimed.pendingEffects).toHaveLength(1);
  expect(await local.get(WorkerService).process(claim)).toBe('completed');
  assertSafeBoundary(await boundary());
});
