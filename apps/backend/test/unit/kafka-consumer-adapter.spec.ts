/** @file Управляемая SDK граница: revoke после DB commit запрещает offset ack; real SQL proof находится в integration. */
import { Kafka, type EachBatchPayload } from 'kafkajs';
import { KafkaApplicationConsumer } from '@backend/infrastructure/kafka-consumer/kafka-consumer';
import { KafkaMessageService } from '@backend/infrastructure/kafka-consumer/services/kafka-message.service';
import { ApplicationConsumerService } from '@backend/infrastructure/worker/services/application-consumer.service';
import { ConsumerRepository } from '@backend/infrastructure/worker/repositories/consumer.repository';
import { HandlerRegistry } from '@backend/infrastructure/worker/services/handler-registry';
const config = {
  brokers: ['localhost:9093'],
  ssl: { rejectUnauthorized: true },
  transactionTimeoutMs: 10000,
  shutdownMs: 20000,
  healthPort: 9102,
};
/** Настоящие SDK объекты с заменой только network methods. DB/handler семантика здесь не симулируется. */
function setup() {
  const kafka = new Kafka({ brokers: config.brokers });
  const consumer = kafka.consumer({ groupId: 'adapter-test' });
  const admin = kafka.admin();
  jest.spyOn(Kafka.prototype, 'consumer').mockReturnValue(consumer);
  jest.spyOn(Kafka.prototype, 'admin').mockReturnValue(admin);
  jest.spyOn(admin, 'connect').mockResolvedValue();
  jest.spyOn(admin, 'disconnect').mockResolvedValue();
  jest.spyOn(admin, 'fetchTopicMetadata').mockResolvedValue({
    topics: [
      {
        name: 'warehouse.receiving.events',
        partitions: [0, 1, 2].map((partitionId) => ({
          partitionId,
          partitionErrorCode: 0,
          leader: 1,
          replicas: [1],
          isr: [1],
        })),
      },
    ],
  });
  jest.spyOn(consumer, 'connect').mockResolvedValue();
  jest.spyOn(consumer, 'disconnect').mockResolvedValue();
  jest.spyOn(consumer, 'subscribe').mockResolvedValue();
  const commits = jest.spyOn(consumer, 'commitOffsets').mockResolvedValue();
  const on = jest.spyOn(consumer, 'on');
  let batch: NonNullable<Parameters<typeof consumer.run>[0]>['eachBatch'];
  jest.spyOn(consumer, 'run').mockImplementation(async (options) => {
    batch = options?.eachBatch;
    const listener = on.mock.calls.find(([event]) => event === consumer.events.GROUP_JOIN)![1];
    await listener({
      id: 'fixture',
      type: consumer.events.GROUP_JOIN,
      timestamp: Date.now(),
      payload: {},
    });
  });
  const messages = new KafkaMessageService(
    {
      run: async () => {
        throw new Error('DB not part of adapter unit test');
      },
    },
    new ApplicationConsumerService(new HandlerRegistry([]), new ConsumerRepository()),
  );
  const process = jest.spyOn(messages, 'process').mockResolvedValue('applied');
  const adapter = new KafkaApplicationConsumer(config, messages);
  const resolveOffset = jest.fn();
  const payload: EachBatchPayload = {
    batch: {
      topic: 'warehouse.receiving.events',
      partition: 0,
      highWatermark: '9007199254740994',
      messages: [
        {
          key: Buffer.from('key'),
          value: Buffer.from('{}'),
          offset: '9007199254740992',
          timestamp: '0',
          attributes: 0,
          headers: {},
        },
      ],
      isEmpty: () => false,
      firstOffset: () => '9007199254740992',
      lastOffset: () => '9007199254740992',
      offsetLag: () => '1',
      offsetLagLow: () => '1',
    },
    heartbeat: async () => {},
    isRunning: () => true,
    isStale: () => false,
    resolveOffset,
    pause: () => () => {},
    commitOffsetsIfNecessary: async () => {},
    uncommittedOffsets: () => ({ topics: [] }),
  };
  return {
    admin,
    consumer,
    adapter,
    process,
    commits,
    resolveOffset,
    payload,
    invoke: () => batch!(payload),
  };
}

test('revocation after DB commit leaves offset unresolved', async () => {
  const f = setup();
  f.process.mockImplementation(async () => {
    f.adapter.stop();
    return 'applied';
  });
  try {
    await f.adapter.start();
    await f.invoke();
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.resolveOffset).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
  }
});

test('offset int64 is never rounded through Number', async () => {
  const f = setup();
  try {
    await f.adapter.start();
    await f.invoke();
    expect(f.commits).toHaveBeenCalledWith([
      { topic: 'warehouse.receiving.events', partition: 0, offset: '9007199254740993' },
    ]);
    expect(f.resolveOffset).toHaveBeenCalledWith('9007199254740992');
  } finally {
    await f.adapter.close();
  }
});

test('heartbeat failure remains fatal when cleanup abort races with pending monitor', async () => {
  const f = setup();
  let monitoring!: () => void,
    rejectHeartbeat!: (error: Error) => void,
    resolveCommit!: () => void,
    resolved!: () => void;
  const monitorStarted = new Promise<void>((resolve) => {
    monitoring = resolve;
  });
  const pendingHeartbeat = new Promise<void>((_, reject) => {
    rejectHeartbeat = reject;
  });
  const pendingCommit = new Promise<void>((resolve) => {
    resolveCommit = resolve;
  });
  const offsetResolved = new Promise<void>((resolve) => {
    resolved = resolve;
  });
  let beats = 0;
  f.payload.heartbeat = async () => {
    if (++beats === 2) {
      monitoring();
      await pendingHeartbeat;
    }
  };
  f.process.mockImplementation(async () => {
    await monitorStarted;
    return 'applied';
  });
  f.commits.mockImplementation(async () => pendingCommit);
  f.resolveOffset.mockImplementation(() => resolved());
  try {
    await f.adapter.start();
    const processing = f.invoke();
    await monitorStarted;
    resolveCommit();
    await offsetResolved;
    // finally уже вызывает wake.abort(); reject относится к network heartbeat,
    // а не к нормальному abort таймера и не должен потеряться при cleanup.
    rejectHeartbeat(new Error('fixture heartbeat rejected'));
    await processing;
    await expect(f.adapter.failure).rejects.toThrow('halted');
    expect(f.adapter.ready).toBe(false);
  } finally {
    resolveCommit();
    rejectHeartbeat(new Error('fixture cleanup'));
    await f.adapter.close();
  }
});

test('unexpected topology refuses startup before DB or offset effects', async () => {
  const f = setup();
  jest.spyOn(f.admin, 'fetchTopicMetadata').mockResolvedValue({ topics: [] });
  try {
    await expect(f.adapter.start()).rejects.toThrow('topology mismatch');
    expect(f.process).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
  }
});

test('missing assignment fails at bounded startup deadline', async () => {
  jest.useFakeTimers();
  const f = setup();
  jest.spyOn(f.consumer, 'run').mockResolvedValue();
  try {
    const refused = expect(f.adapter.start()).rejects.toThrow('assignment timed out');
    await jest.advanceTimersByTimeAsync(45000);
    await refused;
    expect(f.adapter.ready).toBe(false);
  } finally {
    await f.adapter.close();
    jest.useRealTimers();
  }
});
