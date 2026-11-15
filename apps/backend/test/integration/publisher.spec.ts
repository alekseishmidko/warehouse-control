/** @file WMS-503: PostgreSQL + настоящий mTLS Kafka; проверяем durable completion, порядок и неопределённый ack. */
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { GenericContainer, Wait } from 'testcontainers';
import { validatePublisherEnvironment } from '@backend/infrastructure/publisher/publisher.config';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fork, spawn, execFileSync, execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { useDatabaseSuite } from '../support/database-harness';
import { createKafkaFixture, availableLoopbackPort } from '../support/kafka.fixture';
import { outboxFixture } from '../support/outbox.fixture';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import { PublisherRepository } from '@backend/infrastructure/publisher/repositories/publisher.repository';
import { PublisherService } from '@backend/infrastructure/publisher/services/publisher.service';
import {
  KafkaEventTransport,
  kafkaRoute,
} from '@backend/infrastructure/publisher/kafka-event.transport';
import { kafkaTopology } from '@backend/shared/events/generated/kafka-topology';
import { EventContracts } from '@backend/shared/events/services/event-contracts';
import type { KnownEvent } from '@backend/shared/events/dto/event.dto';
import type { EventTransport } from '@backend/shared/transport/event-transport.port';

// Ack loss моделируется после настоящего Kafka commit, поэтому проверяем реальный
// duplicate с прежним eventId. IPC barrier/SIGKILL принадлежат только test child;
// production entrypoint не получает fault-injection flags. Consumer читает read_committed.
jest.setTimeout(180000);
const database = useDatabaseSuite();
let broker: Awaited<ReturnType<typeof createKafkaFixture>>;
let runner: TransactionRunner;
let outbox: OutboxService;
const records: Array<{ event: KnownEvent; key: string; partition: number }> = [];
let consumer: ReturnType<Awaited<ReturnType<typeof createKafkaFixture>>['kafka']['consumer']>;
beforeAll(async () => {
  broker = await createKafkaFixture();
  const app = await database().createHttpApplication();
  runner = app.get(TRANSACTION_RUNNER);
  outbox = app.get(OutboxService);
  consumer = broker.kafka.consumer({
    groupId: `publisher-test-${randomUUID()}`,
    readUncommitted: false,
  });
  await consumer.connect();
  await consumer.subscribe({
    topics: Object.values(kafkaTopology).map((route) => route.topic),
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ message, partition }) => {
      records.push({
        event: JSON.parse(message.value!.toString()) as KnownEvent,
        key: message.key!.toString(),
        partition,
      });
    },
  });
});
afterAll(async () => {
  try {
    await consumer?.disconnect();
  } finally {
    await broker?.dispose();
  }
});
/** Bounded polling наблюдаемого результата; timeout означает отказ, не skip. */
async function until(check: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 30000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Publisher observation timed out');
    await delay(50);
  }
}
/** Наблюдаем именно освобождение DB lock; exit child сам по себе ещё не доказывает обработку TCP FIN PostgreSQL. */
async function ownerReleased() {
  await until(
    async () =>
      (
        await database().connection.pool.query(
          "select count(*)::int n from pg_locks where locktype='advisory' and classid=1464685363 and objid=503",
        )
      ).rows[0].n === 0,
  );
}
/** App owner генерирует envelope, версии и eventId; transport fixture их не конструирует. */
async function appendPair() {
  const input = outboxFixture();
  return runner.run(async (context) => [
    await outbox.append(context, input),
    await outbox.append(context, input),
  ]);
}
/** Новый session owner и новый producer epoch на каждую попытку process lifetime. */
async function open() {
  const repository = await PublisherRepository.acquire(database().connection.pool);
  const transport = new KafkaEventTransport(broker.config);
  try {
    await transport.connect();
  } catch (error) {
    repository.close();
    await transport.close();
    throw error;
  }
  return {
    repository,
    transport,
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
async function status(eventId: string) {
  return (
    await database().connection.pool.query<{ status: string }>(
      "select status from outbox_deliveries where destination='kafka.publish' and event_id=$1",
      [eventId],
    )
  ).rows[0]?.status;
}

test('503.1–3: completion ждёт ack; версии, envelope, key и partition сохранены', async () => {
  const events = await appendPair();
  const owner = await open();
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const publishing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const transport: EventTransport = {
    connect: async () => {},
    close: async () => {},
    publish: async (event) => {
      entered();
      await barrier;
      await owner.transport.publish(event);
    },
  };
  const task = new PublisherService(owner.repository, transport).tick();
  try {
    await publishing;
    expect(await status(events[0].eventId)).toBe('processing');
    expect(
      (
        await database().connection.pool.query(
          "select last_completed_version from delivery_streams where destination='kafka.publish'",
        )
      ).rows[0].last_completed_version,
    ).toBe('0');
    release();
    expect(await task).toBe('completed');
    expect(await owner.service.tick()).toBe('completed');
    await until(
      () => records.filter((r) => r.event.aggregateId === events[0].aggregateId).length === 2,
    );
    const received = records.filter((r) => r.event.aggregateId === events[0].aggregateId);
    expect(received.map((r) => r.event)).toEqual(events);
    expect(received.map((r) => r.key)).toEqual([events[0].aggregateId, events[0].aggregateId]);
    expect(new Set(received.map((r) => r.partition)).size).toBe(1);
    expect(received[0].partition).toBe(kafkaRoute(events[0]).partition);
    expect(await status(events[0].eventId)).toBe('completed');
    expect(
      (await database().connection.pool.query('select count(*)::int n from processed_events'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await database().connection.pool.query(
          "select distinct status from outbox_deliveries where destination='inventory.putaway'",
        )
      ).rows,
    ).toEqual([{ status: 'pending' }]);
  } finally {
    release();
    try {
      await task;
    } finally {
      await owner.close();
    }
  }
});

test.each([
  'inventory.putaway-completed',
  'fulfillment.order-changed',
  'fulfillment.shipping-changed',
  'fulfillment.picking-progressed',
])('503.1–3: %s использует source topic/key и исходный envelope', async (name) => {
  const example = new EventContracts().parseForHandler(
    readFileSync(resolve('../../docs/contracts/examples', name + '.v1.json'), 'utf8'),
  );
  const { eventId, aggregateVersion, ...input } = example;
  const event = await runner.run((context) => outbox.append(context, input));
  const owner = await open();
  try {
    expect(await owner.service.tick()).toBe('completed');
  } finally {
    await owner.close();
  }
  await until(() => records.some((r) => r.event.eventId === event.eventId));
  const received = records.find((r) => r.event.eventId === event.eventId)!;
  expect(received.event).toEqual(event);
  expect(received.key).toBe(event.aggregateId.toLowerCase());
  expect(received.partition).toBe(kafkaRoute(event).partition);
});

test('503.5: broker commit с потерянным ack повторяет тот же eventId прежде следующей версии', async () => {
  const events = await appendPair();
  const owner = await open();
  try {
    const lostAck: EventTransport = {
      connect: async () => {},
      close: async () => {},
      publish: async (event) => {
        await owner.transport.publish(event);
        throw new Error('Injected ack loss');
      },
    };
    await expect(new PublisherService(owner.repository, lostAck).tick()).rejects.toThrow(
      'uncertain',
    );
    expect(await status(events[0].eventId)).toBe('retry');
  } finally {
    await owner.close();
  }
  await until(
    async () =>
      (
        await database().connection.pool.query(
          "select available_at<=clock_timestamp() ready from outbox_deliveries where destination='kafka.publish' and event_id=$1",
          [events[0].eventId],
        )
      ).rows[0].ready === true,
  );
  await ownerReleased();
  const successor = await open();
  try {
    expect(await successor.service.tick()).toBe('completed');
    expect(await successor.service.tick()).toBe('completed');
  } finally {
    await successor.close();
  }
  await until(
    () => records.filter((r) => r.event.aggregateId === events[0].aggregateId).length === 3,
  );
  expect(
    records
      .filter((r) => r.event.aggregateId === events[0].aggregateId)
      .map((r) => r.event.eventId),
  ).toEqual([events[0].eventId, events[0].eventId, events[1].eventId]);
});

test('503.4: второй session owner не запускается', async () => {
  const owner = await open();
  try {
    await expect(PublisherRepository.acquire(database().connection.pool)).rejects.toThrow(
      'singleton',
    );
  } finally {
    await owner.close();
  }
});

/** Реальный child теряет pg socket/producer после SIGKILL; successor читает сохранённый attempt. */
test.each(['before-send', 'after-ack'])('503.5: crash %s не теряет событие', async (phase) => {
  const events = await appendPair();
  const child = fork(resolve('.test-dist/test/support/publisher-child.js'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: database().config.databaseUrl,
      PUBLISHER_ENABLED: 'true',
      PUBLISHER_REPLAY: 'from-start',
      PUBLISHER_BROKERS: broker.config.brokers.join(','),
      PUBLISHER_TRANSACTIONAL_ID: broker.config.transactionalId,
      PUBLISHER_CA_FILE: join(broker.directory, 'ca.crt'),
      PUBLISHER_CERT_FILE: join(broker.directory, 'client.crt'),
      PUBLISHER_KEY_FILE: join(broker.directory, 'client.key'),
      TEST_CRASH_PHASE: phase,
    },
  });
  try {
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(30000) });
    expect(message).toBe('barrier');
    expect(await status(events[0].eventId)).toBe('processing');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) });
      child.kill('SIGKILL');
      await exited;
    }
  }
  await ownerReleased();
  const successor = await open();
  try {
    expect(await successor.service.tick()).toBe('completed');
    expect(await successor.service.tick()).toBe('completed');
  } finally {
    await successor.close();
  }
  const count = phase === 'after-ack' ? 3 : 2;
  await until(
    () => records.filter((r) => r.event.aggregateId === events[0].aggregateId).length === count,
  );
  expect(
    records
      .filter((r) => r.event.aggregateId === events[0].aggregateId)
      .map((r) => r.event.eventId),
  ).toEqual(
    phase === 'after-ack'
      ? [events[0].eventId, events[0].eventId, events[1].eventId]
      : events.map((e) => e.eventId),
  );
});

test('503.4: stable transactionalId fences старую transaction; read_committed скрывает abort', async () => {
  const events = await appendPair();
  const old = broker.kafka.producer({
    transactionalId: broker.config.transactionalId,
    idempotent: true,
    maxInFlightRequests: 1,
  });
  await old.connect();
  try {
    const transaction = await old.transaction();
    const route = kafkaRoute(events[0]);
    await transaction.send({
      topic: route.topic,
      acks: -1,
      messages: [{ key: route.key, partition: route.partition, value: JSON.stringify(events[0]) }],
    });
    const successor = await open();
    try {
      expect(await successor.service.tick()).toBe('completed');
      expect(await successor.service.tick()).toBe('completed');
    } finally {
      await successor.close();
    }
    await expect(transaction.commit()).rejects.toThrow();
    await until(
      () => records.filter((r) => r.event.aggregateId === events[0].aggregateId).length === 2,
    );
    expect(
      records
        .filter((r) => r.event.aggregateId === events[0].aggregateId)
        .map((r) => r.event.eventId),
    ).toEqual(events.map((e) => e.eventId));
  } finally {
    await old.disconnect();
  }
});

test('503.3: stale completion/retry откатываются и не продвигают cursor', async () => {
  const events = await appendPair();
  const owner = await open();
  try {
    const record = await owner.repository.next();
    if (!record) throw new Error('Missing claim');
    await expect(owner.repository.complete({ ...record, token: randomUUID() })).rejects.toThrow(
      'Stale',
    );
    await expect(
      owner.repository.fail({ ...record, token: randomUUID() }, 'TRANSIENT_FAILURE'),
    ).rejects.toThrow('Stale');
    expect(await status(events[0].eventId)).toBe('processing');
    expect(
      (
        await database().connection.pool.query(
          "select last_completed_version from delivery_streams where destination='kafka.publish'",
        )
      ).rows[0].last_completed_version,
    ).toBe('0');
  } finally {
    await owner.close();
  }
});

test('503.3: несовпадающая identity становится dead; следующий aggregate не заблокирован', async () => {
  const events = await appendPair();
  const owner = await open();
  try {
    const record = await owner.repository.next();
    if (!record) throw new Error('Missing claim');
    jest
      .spyOn(owner.repository, 'next')
      .mockResolvedValueOnce({ ...record, envelope: { ...events[0], aggregateVersion: 2 } });
    expect(await owner.service.tick()).toBe('dead');
    expect(await owner.service.tick()).toBe('idle');
    expect(await status(events[0].eventId)).toBe('dead');
    expect(records.filter((r) => r.event.aggregateId === events[0].aggregateId)).toHaveLength(0);
    const input = outboxFixture();
    await runner.run((context) => outbox.append(context, input));
    expect(await owner.service.tick()).toBe('completed');
  } finally {
    await owner.close();
  }
});

test('503.4: потеря PG owner после broker ack запрещает completion; successor повторяет eventId', async () => {
  const events = await appendPair();
  const owner = await open();
  try {
    const lostSession: EventTransport = {
      connect: async () => {},
      close: async () => {},
      publish: async (event) => {
        await owner.transport.publish(event);
        await database().connection.pool.query(
          "select pg_terminate_backend(pid) from pg_locks where locktype='advisory' and classid=1464685363 and objid=503",
        );
        await until(async () => {
          try {
            await owner.repository.assertReady();
            return false;
          } catch {
            return true;
          }
        });
      },
    };
    await expect(new PublisherService(owner.repository, lostSession).tick()).rejects.toThrow();
    expect(await status(events[0].eventId)).toBe('processing');
  } finally {
    await owner.close();
  }
  await ownerReleased();
  const successor = await open();
  try {
    expect(await successor.service.tick()).toBe('completed');
    expect(await successor.service.tick()).toBe('completed');
  } finally {
    await successor.close();
  }
  await until(
    () => records.filter((r) => r.event.aggregateId === events[0].aggregateId).length === 3,
  );
  expect(
    records
      .filter((r) => r.event.aggregateId === events[0].aggregateId)
      .map((r) => r.event.eventId),
  ).toEqual([events[0].eventId, events[0].eventId, events[1].eventId]);
});

test('503.1: неполная retained history запрещает from-start startup и освобождает lock', async () => {
  await database().connection.pool.query(
    "insert into outbox_aggregate_sequences(aggregate_type,aggregate_id,last_version) values('receipt',$1,1)",
    [randomUUID()],
  );
  await expect(PublisherRepository.acquire(database().connection.pool)).rejects.toThrow(
    'complete retained history',
  );
  expect(
    (
      await database().connection.pool.query(
        "select count(*)::int n from pg_locks where locktype='advisory' and classid=1464685363 and objid=503",
      )
    ).rows[0].n,
  ).toBe(0);
});

test('503.2: конфигурация требует opt-in, mTLS и допустимые timeout/ports', () => {
  const env = {
    PUBLISHER_ENABLED: 'true',
    PUBLISHER_REPLAY: 'from-start',
    PUBLISHER_BROKERS: broker.config.brokers.join(','),
    PUBLISHER_TRANSACTIONAL_ID: broker.config.transactionalId,
    PUBLISHER_CA_FILE: join(broker.directory, 'ca.crt'),
    PUBLISHER_CERT_FILE: join(broker.directory, 'client.crt'),
    PUBLISHER_KEY_FILE: join(broker.directory, 'client.key'),
  };
  expect(validatePublisherEnvironment(env).ssl).toMatchObject({ rejectUnauthorized: true });
  for (const patch of [
    { PUBLISHER_ENABLED: 'false' },
    { PUBLISHER_REPLAY: 'boundary' },
    { PUBLISHER_BROKERS: 'localhost:65536' },
    { PUBLISHER_TRANSACTIONAL_ID: 'random ID' },
    { PUBLISHER_KEY_FILE: '/missing' },
    { PUBLISHER_POLL_MS: '0' },
    { PUBLISHER_SHUTDOWN_MS: '100' },
    { PUBLISHER_HEALTH_PORT: 'no' },
  ]) {
    expect(() => validatePublisherEnvironment({ ...env, ...patch })).toThrow();
  }
});

test.each([9, 10])(
  '503.3: бюджет попыток %i блокирует только свой stream без ложного completion',
  async (previous) => {
    const events = await appendPair();
    const owner = await open();
    try {
      const record = await owner.repository.next();
      if (!record) throw new Error('Missing claim');
      await database().connection.pool.query(
        "update outbox_deliveries set attempts=$2 where event_id=$1 and destination='kafka.publish'",
        [record.eventId, previous],
      );
      const publish = jest
        .spyOn(owner.transport, 'publish')
        .mockRejectedValue(new Error('Injected outage'));
      if (previous === 10) {
        expect(await owner.service.tick()).toBe('dead');
        expect(publish).not.toHaveBeenCalled();
      } else {
        await expect(owner.service.tick()).rejects.toThrow('uncertain');
      }
      expect(await status(events[0].eventId)).toBe('dead');
      expect(await owner.service.tick()).toBe('idle');
    } finally {
      await owner.close();
    }
  },
);

test('503.2: неизвестная schemaVersion не отправляется и фиксируется безопасным кодом', async () => {
  const events = await appendPair();
  const owner = await open();
  try {
    const record = await owner.repository.next();
    if (!record) throw new Error('Missing claim');
    jest
      .spyOn(owner.repository, 'next')
      .mockResolvedValueOnce({ ...record, envelope: { ...events[0], schemaVersion: 999 } });
    const publish = jest.spyOn(owner.transport, 'publish');
    expect(await owner.service.tick()).toBe('dead');
    expect(publish).not.toHaveBeenCalled();
    expect(await status(events[0].eventId)).toBe('dead');
  } finally {
    await owner.close();
  }
});

test('503: root pnpm publisher выполняет Registry preflight, readiness и SIGTERM cleanup', async () => {
  const root = resolve('../..');
  const image = readFileSync(join(root, 'infra/registry/compose.yaml'), 'utf8').match(
    /image: (\S+)/,
  )?.[1];
  if (!image) throw new Error('Registry image missing');
  const registry = await new GenericContainer(image)
    .withExposedPorts(8080)
    .withEnvironment({ QUARKUS_HTTP_HOST: '0.0.0.0' })
    .withWaitStrategy(Wait.forHttp('/apis/registry/v3/system/info', 8080))
    .withStartupTimeout(120000)
    .start();
  const healthPort = await availableLoopbackPort();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_FORMAT: 'json',
    DATABASE_URL: database().config.databaseUrl,
    PUBLISHER_ENABLED: 'true',
    PUBLISHER_REPLAY: 'from-start',
    PUBLISHER_BROKERS: broker.config.brokers.join(','),
    PUBLISHER_TRANSACTIONAL_ID: broker.config.transactionalId,
    PUBLISHER_CA_FILE: join(broker.directory, 'ca.crt'),
    PUBLISHER_CERT_FILE: join(broker.directory, 'client.crt'),
    PUBLISHER_KEY_FILE: join(broker.directory, 'client.key'),
    PUBLISHER_HEALTH_PORT: String(healthPort),
    WMS_REGISTRY_URL: `http://127.0.0.1:${registry.getMappedPort(8080)}`,
    WMS_SCHEMA_BASE: 'HEAD',
  };
  let child: ReturnType<typeof spawn> | undefined;
  let output = '';
  try {
    await promisify(execFile)('pnpm', ['registry:publish'], {
      cwd: root,
      env,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    // Неверная config должна объяснять отказ статическим кодом и не отражать введённые credentials.
    for (const [patch, errorCode] of [
      [{ PUBLISHER_ENABLED: 'false' }, 'PUBLISHER_OPT_IN_REQUIRED'],
      [
        { PUBLISHER_BROKERS: 'user:WMS503_CANARY_PASSWORD@localhost:9093' },
        'PUBLISHER_BROKERS_INVALID',
      ],
      [{ PUBLISHER_KEY_FILE: '/missing/publisher-key.pem' }, 'PUBLISHER_TLS_INVALID'],
    ] as const) {
      output = '';
      child = spawn('pnpm', ['publisher'], {
        cwd: root,
        env: { ...env, ...patch },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        output += String(chunk);
      });
      const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(30000) });
      expect(code).toBe(1);
      expect(output).toContain(`"errorCode":"${errorCode}"`);
      expect(output).not.toContain('WMS503_CANARY_PASSWORD');
      expect(
        (
          await database().connection.pool.query(
            "select count(*)::int n from pg_locks where locktype='advisory' and classid=1464685363 and objid=503",
          )
        ).rows[0].n,
      ).toBe(0);
    }
    output = '';
    child = spawn('pnpm', ['publisher'], {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    await until(async () => {
      if (child?.exitCode !== null) throw new Error('Root publisher exited before readiness');
      try {
        return (await fetch(`http://127.0.0.1:${healthPort}/health/ready`)).status === 200;
      } catch {
        return false;
      }
    });
    expect(output).toContain('PASS Registry check');
    expect(output).toContain('publisher.ready');
    const exit = once(child, 'exit');
    process.kill(-child.pid!, 'SIGTERM');
    await exit;
    await ownerReleased();
    expect(output).not.toContain('process.failed');
    expect(output).not.toContain('publisher.shutdown_deadline');
    expect(output).not.toContain('TimeoutNegativeWarning');
    // Root pnpm wrapper завершается от сигнала; отдельный Node PID подтверждает штатный exit0 самого entrypoint.
    child = spawn(process.execPath, ['dist/publisher.js'], {
      cwd: resolve('.'),
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    await until(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${healthPort}/health/ready`)).status === 200;
      } catch {
        return false;
      }
    });
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    const [code] = await stopped;
    expect(code).toBe(0);
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      process.kill(-child.pid, 'SIGTERM');
      await exit;
    }
    await registry.stop();
  }
});
test('503.5–6: outage не блокирует бизнес-commit; retry не завершает delivery', async () => {
  const owner = await open();
  await consumer.disconnect();
  execFileSync('docker', ['stop', '-t', '1', broker.container.getId()], { stdio: 'ignore' });
  try {
    const app = await database().createHttpApplication();
    await postedReceiptFixture(app);
    expect(
      (await database().connection.pool.query('select sum(on_hand)::int n from stock_balances'))
        .rows[0].n,
    ).toBe(10);
    await expect(owner.service.tick()).rejects.toThrow('uncertain');
    expect(
      (
        await database().connection.pool.query(
          "select status from outbox_deliveries where destination='kafka.publish'",
        )
      ).rows,
    ).toEqual([{ status: 'retry' }]);
  } finally {
    await owner.close();
    execFileSync('docker', ['start', broker.container.getId()], { stdio: 'ignore' });
  }
  // Listener и metadata должны отвечать после docker start; создание контейнера не доказывает readiness.
  await until(async () => {
    const admin = broker.kafka.admin();
    try {
      await admin.connect();
      await admin.fetchTopicMetadata({
        topics: Object.values(kafkaTopology).map((route) => route.topic),
      });
      return true;
    } catch {
      return false;
    } finally {
      await admin.disconnect();
    }
  });
  const successor = await open();
  try {
    await until(async () => {
      const r = await successor.service.tick();
      return r === 'completed';
    });
  } finally {
    await successor.close();
  }
});

test('503.2: изменение partitions отклоняется до публикации', async () => {
  const admin = broker.kafka.admin();
  await admin.connect();
  try {
    await admin.createPartitions({
      topicPartitions: [{ topic: 'warehouse.fulfillment.order.events', count: 6 }],
      validateOnly: false,
    });
  } finally {
    await admin.disconnect();
  }
  const transport = new KafkaEventTransport(broker.config);
  try {
    await expect(transport.connect()).rejects.toThrow('topology mismatch');
  } finally {
    await transport.close();
  }
});
