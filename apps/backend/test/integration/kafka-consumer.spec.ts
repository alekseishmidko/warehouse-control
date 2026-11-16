/** @file WMS-504: реальные Kafka mTLS/PostgreSQL, business invariants, offset boundary, rebalance и child crash. */
import type { INestApplicationContext } from '@nestjs/common';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { createKafkaFixture, availableLoopbackPort } from '../support/kafka.fixture';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { outboxFixture } from '../support/outbox.fixture';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import type { KnownEvent } from '@backend/shared/events/dto/event.dto';
import { kafkaRoute } from '@backend/shared/events/kafka-route';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { ApplicationConsumerService } from '@backend/infrastructure/worker/services/application-consumer.service';
import { StaleDeliveryError } from '@backend/infrastructure/worker/delivery-policy';
import { KafkaConsumerModule } from '@backend/infrastructure/kafka-consumer/kafka-consumer.module';
import { KafkaMessageService } from '@backend/infrastructure/kafka-consumer/services/kafka-message.service';
import { KafkaEventTransport } from '@backend/infrastructure/publisher/kafka-event.transport';
import { KafkaApplicationConsumer } from '@backend/infrastructure/kafka-consumer/kafka-consumer';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import type { ConsumerConfig } from '@backend/infrastructure/kafka-consumer/consumer.config';
import type { LocalEventHandler } from '@backend/infrastructure/worker/dto/delivery.dto';
import type { KafkaMessage, IHeaders } from 'kafkajs';

jest.setTimeout(120000);
const cleanup: Array<() => Promise<unknown>> = [];
// Consumers закрываются ДО reset disposable БД, иначе старый batch мог бы обратиться к уже удалённому event.
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const database = useDatabaseSuite();
let broker: Awaited<ReturnType<typeof createKafkaFixture>>;
let api: INestApplicationContext;
let config: ConsumerConfig;
beforeAll(async () => {
  broker = await createKafkaFixture();
  api = await database().createHttpApplication({ imports: [KafkaConsumerModule] });
  config = {
    brokers: broker.config.brokers,
    ssl: broker.config.ssl,
    transactionTimeoutMs: 10000,
    shutdownMs: 20000,
    healthPort: 9102,
  };
});
afterAll(async () => {
  await broker?.dispose();
});
beforeEach(async () => {
  const admin = broker.kafka.admin();
  try {
    await admin.connect();
    const groups = await admin.listGroups();
    if (groups.groups.some((g) => g.groupId === 'inventory.putaway'))
      await admin.deleteGroups(['inventory.putaway']);
    const topic = 'warehouse.receiving.events';
    const offsets = await admin.fetchTopicOffsets(topic);
    await admin.deleteTopicRecords({
      topic,
      partitions: offsets.map((p) => ({ partition: p.partition, offset: p.high })),
    });
  } finally {
    await admin.disconnect();
  }
});
/** Bounded polling наблюдает commit/assignment, sleep не служит доказательством гонки. */
async function until(check: () => Promise<boolean> | boolean, timeout = 30000): Promise<void> {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Kafka consumer observation timed out');
    await delay(25);
  }
}
/** Прямой wire fixture использует реальные broker offsets; business events получены только через production writer. */
function record(
  event: KnownEvent,
): Omit<KafkaMessage, 'size' | 'headers'> & { size?: undefined; headers: IHeaders } {
  return {
    key: Buffer.from(kafkaRoute(event).key),
    value: Buffer.from(JSON.stringify(event)),
    offset: '0',
    timestamp: String(Date.now()),
    attributes: 0,
    headers: {
      'content-type': 'application/json',
      'x-event-type': event.type,
      'x-schema-version': String(event.schemaVersion),
    },
  };
}
async function publish(events: KnownEvent[]) {
  const producer = broker.kafka.producer();
  await producer.connect();
  try {
    for (const event of events) {
      const route = kafkaRoute(event);
      await producer.send({
        topic: route.topic,
        acks: -1,
        messages: [{ ...record(event), partition: route.partition }],
      });
    }
  } finally {
    await producer.disconnect();
  }
}
async function eventForReceipt(): Promise<KnownEvent> {
  const receipt = await postedReceiptFixture(api);
  return (
    await database().connection.pool.query<{ envelope: KnownEvent }>(
      'select envelope from outbox_events where aggregate_id=$1',
      [receipt.document.id],
    )
  ).rows[0].envelope;
}
/** Только technical protocol cases подменяют handler; production business case использует настоящий InventoryService. */
async function graph(handle?: LocalEventHandler['handle']) {
  const app = await database().createWorkerApplication(
    handle ? [{ destination: 'inventory.putaway', handle }] : undefined,
  );
  cleanup.push(() => app.close());
  return {
    app,
    messages: new KafkaMessageService(
      app.get(TRANSACTION_RUNNER),
      app.get(ApplicationConsumerService),
    ),
  };
}
async function open(messages: KafkaMessageService) {
  const consumer = new KafkaApplicationConsumer(config, messages);
  cleanup.push(() => consumer.close());
  await consumer.start();
  return consumer;
}
async function state() {
  return (
    await database().connection.pool.query<{
      tasks: number;
      markers: number;
      cursor: number;
      stock: number;
      movements: number;
      audit: number;
    }>(`select
    (select count(*)::int from putaway_tasks) tasks,
    (select count(*)::int from processed_events) markers,
    coalesce((select max(last_processed_version)::int from consumer_streams),0) cursor,
    coalesce((select sum(on_hand)::int from stock_balances),0) stock,
    (select count(*)::int from stock_movements) movements,
    (select count(*)::int from audit_entries where action='inventory.putaway-task-created') audit`)
  ).rows[0];
}
async function offsets() {
  const admin = broker.kafka.admin();
  try {
    await admin.connect();
    return await admin.fetchOffsets({
      groupId: 'inventory.putaway',
      topics: ['warehouse.receiving.events'],
    });
  } finally {
    await admin.disconnect();
  }
}
async function offset(partition: number) {
  return (await offsets())[0].partitions.find((p) => p.partition === partition)!.offset;
}
async function currentMessageOffset(event: KnownEvent) {
  const admin = broker.kafka.admin();
  try {
    await admin.connect();
    return (await admin.fetchTopicOffsets(kafkaRoute(event).topic)).find(
      (p) => p.partition === kafkaRoute(event).partition,
    )!.high;
  } finally {
    await admin.disconnect();
  }
}

test('504.1–4: real Kafka delivery and duplicate preserve one business effect', async () => {
  const event = await eventForReceipt();
  const { messages } = await graph();
  const consumer = await open(messages);
  expect(consumer.ready).toBe(true);
  await publish([event, event]);
  const end = await currentMessageOffset(event);
  await until(async () => (await offset(kafkaRoute(event).partition)) === end);
  expect(await state()).toMatchObject({ tasks: 1, markers: 1, cursor: 1, stock: 10, movements: 1 });
  const local = (await database().createWorkerApplication()).get(WorkerService);
  const [claim] = await local.claim();
  expect(await local.process(claim)).toBe('completed');
  expect(await state()).toMatchObject({ tasks: 1, markers: 1, cursor: 1, stock: 10, movements: 1 });
});

test('read_committed ignores aborted poison and reads real transactional publisher', async () => {
  const event = await eventForReceipt();
  const { messages } = await graph();
  const consumer = await open(messages);
  const producer = broker.kafka.producer({
    transactionalId: 'consumer-abort-fixture',
    idempotent: true,
    maxInFlightRequests: 1,
  });
  const transport = new KafkaEventTransport(broker.config);
  try {
    await producer.connect();
    const transaction = await producer.transaction();
    const route = kafkaRoute(event);
    await transaction.send({
      topic: route.topic,
      acks: -1,
      messages: [
        {
          key: route.key,
          partition: route.partition,
          value: JSON.stringify({ ...event, schemaVersion: 99 }),
        },
      ],
    });
    await transaction.abort();
    await transport.connect();
    await transport.publish(event);
    await until(async () => (await state()).markers === 1);
    expect(consumer.ready).toBe(true);
    expect(await state()).toMatchObject({ tasks: 1, stock: 10, movements: 1 });
  } finally {
    await transport.close();
    await producer.disconnect();
  }
});

test('local and Kafka share cursor locks and never duplicate one business effect', async () => {
  const event = await eventForReceipt();
  const base = await graph();
  const local = (await graph()).app.get(WorkerService);
  const [claim] = await local.claim();
  let entered!: () => void, release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const application = base.app.get(ApplicationConsumerService);
  const original = application.apply.bind(application);
  const spy = jest.spyOn(application, 'apply').mockImplementation(async (...args) => {
    const result = await original(...args);
    entered();
    await barrier;
    return result;
  });
  const route = kafkaRoute(event);
  const first = base.messages.process(
    route.topic,
    route.partition,
    record(event),
    () => true,
    10000,
  );
  let second: Promise<string> | undefined;
  try {
    await Promise.race([
      started,
      first.then(() => {
        throw new Error('Missing DB barrier');
      }),
    ]);
    second = local.process(claim);
    await until(
      async () =>
        (
          await database().connection.pool.query(
            "select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like '%consumer_streams%'",
          )
        ).rows[0].n > 0,
    );
    release();
    expect(await first).toBe('applied');
    expect(await second).toBe('completed');
    expect(await state()).toMatchObject({
      tasks: 1,
      markers: 1,
      cursor: 1,
      stock: 10,
      movements: 1,
      audit: 1,
    });
  } finally {
    release();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    spy.mockRestore();
  }
});

test('504.2: invalid routing and unknown schema have no effects', async () => {
  const event = await eventForReceipt();
  const { messages } = await graph();
  const route = kafkaRoute(event);
  const valid = record(event);
  for (const message of [
    { ...valid, value: null },
    { ...valid, value: Buffer.from('{') },
    { ...valid, value: Buffer.from(JSON.stringify({ ...event, schemaVersion: 99 })) },
    { ...valid, key: Buffer.from('wrong') },
    { ...valid, value: Buffer.from(JSON.stringify({ ...event, eventId: randomUUID() })) },
    { ...valid, headers: {} },
    { ...valid, headers: { ...valid.headers, 'x-schema-version': ['1', '2'] } },
    {
      ...valid,
      value: Buffer.from(
        JSON.stringify({ ...event, correlationId: '00000000-0000-4000-8000-000000000001' }),
      ),
    },
  ])
    await expect(
      messages.process(route.topic, route.partition, message, () => true, 10000),
    ).rejects.toThrow();
  await expect(
    messages.process('wrong-topic', route.partition, valid, () => true, 10000),
  ).rejects.toThrow();
  await expect(
    messages.process(route.topic, (route.partition + 1) % 3, valid, () => true, 10000),
  ).rejects.toThrow();
  await expect(
    messages.process(route.topic, route.partition, valid, () => false, 10000),
  ).rejects.toThrow();
  expect(await state()).toMatchObject({ tasks: 0, markers: 0, cursor: 0, stock: 10 });
});

test('504.3: failure after handler rolls back effect marker cursor', async () => {
  const event = await eventForReceipt();
  const { messages } = await graph();
  const pool = database().connection.pool;
  await pool.query(`create function fail_kafka_marker() returns trigger language plpgsql as $$begin raise exception 'test marker fault'; end$$;
    create trigger fail_kafka_marker before insert on processed_events for each row execute function fail_kafka_marker()`);
  try {
    const consumer = await open(messages);
    await publish([event]);
    await expect(consumer.failure).rejects.toThrow('halted');
    expect(await state()).toMatchObject({
      tasks: 0,
      markers: 0,
      cursor: 0,
      stock: 10,
      movements: 1,
    });
    expect(await offset(kafkaRoute(event).partition)).toBe('-1');
  } finally {
    await pool.query(
      'drop trigger fail_kafka_marker on processed_events; drop function fail_kafka_marker()',
    );
  }
});

test('504.4: gap fails closed and does not apply following version', async () => {
  const input = outboxFixture();
  const events = await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run(async (context) => [
      await api.get(OutboxService).append(context, input),
      await api.get(OutboxService).append(context, input),
      await api.get(OutboxService).append(context, input),
    ]);
  const { messages } = await graph(async () => {
    throw new Error('handler must not run for gap');
  });
  const consumer = await open(messages);
  await publish(events.slice(1));
  await expect(consumer.failure).rejects.toThrow('halted');
  expect(await state()).toMatchObject({ markers: 0, cursor: 0 });
  expect(await offset(kafkaRoute(events[0]).partition)).toBe('-1');
});

test('504.5: rebalance during active transaction rolls back and successor applies once', async () => {
  const event = await eventForReceipt();
  const base = await graph();
  const apply = base.app.get(ApplicationConsumerService);
  let entered!: () => void, release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const original = apply.apply.bind(apply);
  const spy = jest.spyOn(apply, 'apply').mockImplementation(async (...args) => {
    const result = await original(...args);
    entered();
    await barrier;
    return result;
  });
  let firstAttempt: ReturnType<KafkaMessageService['process']> | undefined;
  const originalProcess = base.messages.process.bind(base.messages);
  jest.spyOn(base.messages, 'process').mockImplementation((...args) => {
    firstAttempt = originalProcess(...args);
    return firstAttempt;
  });
  const first = await open(base.messages);
  let second: KafkaApplicationConsumer | undefined;
  let allowNext!: () => void;
  let nextEntered!: () => void;
  const nextBarrier = new Promise<void>((resolve) => {
    allowNext = resolve;
  });
  const nextStarted = new Promise<void>((resolve) => {
    nextEntered = resolve;
  });
  try {
    await publish([event]);
    await Promise.race([started, first.failure]);
    expect(await state()).toMatchObject({ tasks: 0, markers: 0 }); // uncommitted effect невидим
    const next = await graph();
    const nextProcess = next.messages.process.bind(next.messages);
    next.messages.process = async (...args) => {
      nextEntered();
      await nextBarrier;
      return nextProcess(...args);
    };
    second = new KafkaApplicationConsumer(config, next.messages);
    cleanup.push(() => second!.close());
    const joining = second.start();
    // Новый member вызывает настоящий coordinator rebalance. Heartbeat первого batch
    // обнаруживает revoke, но barrier удерживает DB callback до явного release.
    const admin = broker.kafka.admin();
    try {
      await admin.connect();
      await until(
        async () =>
          (await admin.describeGroups(['inventory.putaway'])).groups[0].state ===
          'PreparingRebalance',
      );
      await until(() => !first.ready); // instrumentation/heartbeat loss, не случайный sleep
    } finally {
      await admin.disconnect();
    }
    release();
    await expect(first.failure).rejects.toThrow('halted');
    await expect(firstAttempt).rejects.toBeInstanceOf(StaleDeliveryError);
    await first.close();
    await joining;
    await Promise.race([nextStarted, second.failure]);
    expect(await state()).toMatchObject({ tasks: 0, markers: 0, cursor: 0 });
    expect(await offset(kafkaRoute(event).partition)).toBe('-1');
    allowNext();
    await until(async () => (await state()).markers === 1);
    expect(await state()).toMatchObject({
      tasks: 1,
      markers: 1,
      cursor: 1,
      stock: 10,
      movements: 1,
    });
  } finally {
    release();
    allowNext();
    spy.mockRestore();
  }
});

test('504.6: Kafka starts at N+1 after local completion', async () => {
  // Текущий domain выдаёт один receipt-posted факт; вторая синтетическая valid version
  // проверяет continuity, не вводя повторное бизнес-проведение receipt.
  const input = outboxFixture();
  const events = await api
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run(async (context) => [
      await api.get(OutboxService).append(context, input),
      await api.get(OutboxService).append(context, input),
    ]);
  const effect: LocalEventHandler['handle'] = async (context, event) => {
    await transactionClient(context).execute(
      sql`insert into application_metadata(key,value) values(${event.eventId},'1') on conflict(key) do update set value=(application_metadata.value::int+1)::text`,
    );
  };
  const { app, messages } = await graph(effect);
  const local = app.get(WorkerService);
  const [claim] = await local.claim();
  expect(await local.process(claim)).toBe('completed');
  const consumer = await open(messages);
  await publish([events[1], events[0], events[1]]);
  const end = await currentMessageOffset(events[0]);
  await until(async () => (await offset(kafkaRoute(events[0]).partition)) === end);
  expect(consumer.ready).toBe(true);
  expect(await state()).toMatchObject({ markers: 2, cursor: 2 });
  expect(
    (await database().connection.pool.query('select value from application_metadata order by key'))
      .rows,
  ).toEqual([{ value: '1' }, { value: '1' }]);
});

/** Ephemeral mTLS files belong только этому broker fixture; ни рабочая .env, ни Secret не меняются. */
function environment(healthPort: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: database().config.databaseUrl,
    WORKER_LEASE_MS: '0', // Kafka graph не должен читать local scheduler config.
    CONSUMER_ENABLED: 'true',
    CONSUMER_START: 'retained-cursor',
    CONSUMER_BROKERS: config.brokers.join(','),
    CONSUMER_CA_FILE: join(broker.directory, 'ca.crt'),
    CONSUMER_CERT_FILE: join(broker.directory, 'client.crt'),
    CONSUMER_KEY_FILE: join(broker.directory, 'client.key'),
    CONSUMER_HEALTH_PORT: String(healthPort),
    LOG_FORMAT: 'json',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
  };
}
async function kill(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (child.pid) process.kill(-child.pid, signal);
  await exited;
}

test('504.6: child crash after DB commit replays without second effect', async () => {
  const event = await eventForReceipt();
  await publish([event]);
  const child = fork(resolve('.test-dist/test/support/consumer-child.js'), [], {
    env: environment(await availableLoopbackPort()),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    expect((await once(child, 'message'))[0]).toBe('committed');
    expect(await state()).toMatchObject({ tasks: 1, markers: 1, cursor: 1 });
    expect(await offset(kafkaRoute(event).partition)).toBe('-1');
    await kill(child, 'SIGKILL');
  } finally {
    await kill(child, 'SIGKILL');
  }
  const { messages } = await graph();
  await open(messages);
  const end = await currentMessageOffset(event);
  await until(async () => (await offset(kafkaRoute(event).partition)) === end);
  expect(await state()).toMatchObject({ tasks: 1, markers: 1, cursor: 1, stock: 10, movements: 1 });
});

test('consumer validates runtime budgets with real TLS files', async () => {
  const { validateConsumerEnvironment } =
    await import('@backend/infrastructure/kafka-consumer/consumer.config');
  const env = environment(9102);
  expect(validateConsumerEnvironment(env)).toMatchObject({
    transactionTimeoutMs: 10000,
    healthPort: 9102,
  });
  const invalidSettings: Array<[string, string | undefined]> = [
    ['CONSUMER_TRANSACTION_TIMEOUT_MS', '0'],
    ['CONSUMER_TRANSACTION_TIMEOUT_MS', '10001'],
    ['CONSUMER_SHUTDOWN_MS', 'NaN'],
    ['CONSUMER_SHUTDOWN_MS', '12000'],
    ['CONSUMER_HEALTH_PORT', '65536'],
    ['CONSUMER_CA_FILE', undefined],
    ['CONSUMER_CERT_FILE', undefined],
    ['CONSUMER_KEY_FILE', undefined],
  ];
  for (const [name, value] of invalidSettings) {
    expect(() => validateConsumerEnvironment({ ...env, [name]: value })).toThrow('configuration');
  }
});

test('Node consumer entrypoint exits zero after readiness and SIGTERM', async () => {
  const port = await availableLoopbackPort();
  const child = spawn(process.execPath, ['dist/consumer.js'], {
    env: environment(port),
    detached: true,
    stdio: 'ignore',
  });
  try {
    await until(async () => {
      if (child.exitCode !== null) throw new Error('Consumer exited before ready');
      try {
        return (await fetch(`http://127.0.0.1:${port}/health/ready`)).status === 200;
      } catch {
        return false;
      }
    });
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    expect((await exited)[0]).toBe(0);
  } finally {
    await kill(child, 'SIGKILL');
  }
});

test('root pnpm consumer reaches ready and shuts down normally', async () => {
  const port = await availableLoopbackPort();
  const child = spawn('pnpm', ['consumer'], {
    cwd: resolve('../..'),
    env: environment(port),
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let output = '';
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  try {
    await until(async () => {
      if (child.exitCode !== null) throw new Error('Consumer exited before readiness');
      try {
        return (await fetch(`http://127.0.0.1:${port}/health/ready`)).status === 200;
      } catch {
        return false;
      }
    });
    await kill(child, 'SIGTERM');
    // pnpm wrapper завершается сигналом; Node entrypoint ниже проверяется на exit0 отдельно.
    expect(child.signalCode).toBe('SIGTERM');
    expect(output).not.toContain(database().config.databaseUrl);
    expect(output).toContain('consumer.ready');
  } finally {
    await kill(child, 'SIGKILL');
  }
});
