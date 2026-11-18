/** @file Управляемая SDK граница: revoke после DB commit запрещает offset ack; real SQL proof находится в integration. */
import { randomBytes } from 'node:crypto';
import { KafkaRecoveryService } from '@backend/infrastructure/kafka-consumer/services/kafka-recovery.service';
import {
  QuarantineRepository,
  PartitionBlockedError,
} from '@backend/infrastructure/kafka-consumer/repositories/quarantine.repository';
import { QuarantineCrypto } from '@backend/infrastructure/kafka-consumer/quarantine-crypto';
import { AuditService } from '@backend/modules/audit/services/audit.service';
import { AuditRepository } from '@backend/modules/audit/repositories/audit.repository';
import { renderMetrics } from '@backend/infrastructure/metrics/runtime-metrics';
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
function setup(recovery?: KafkaRecoveryService) {
  const kafka = new Kafka({ brokers: config.brokers });
  const consumer = kafka.consumer({ groupId: 'adapter-test' });
  const admin = kafka.admin();
  jest.spyOn(Kafka.prototype, 'consumer').mockReturnValue(consumer);
  jest.spyOn(Kafka.prototype, 'admin').mockReturnValue(admin);
  jest.spyOn(admin, 'connect').mockResolvedValue();
  jest.spyOn(admin, 'disconnect').mockResolvedValue();
  jest
    .spyOn(admin, 'fetchTopicOffsets')
    .mockResolvedValue(
      [0, 1, 2].map((partition) => ({ partition, offset: '2', low: '0', high: '2' })),
    );
  jest.spyOn(admin, 'fetchOffsets').mockResolvedValue([
    {
      topic: 'warehouse.receiving.events',
      partitions: [0, 1, 2].map((partition) => ({ partition, offset: '-1', metadata: null })),
    },
  ]);
  jest.spyOn(consumer, 'resume').mockImplementation(() => {});
  jest.spyOn(consumer, 'seek').mockImplementation(() => {});
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
  const notify = async (event: string) => {
    const listener = on.mock.calls.find(([name]) => name === event)![1];
    await listener({ id: 'fixture', type: event, timestamp: Date.now(), payload: {} });
  };
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
  const adapter = new KafkaApplicationConsumer(config, messages, recovery);
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
    notify,
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

/** Только transport orchestration: SQL вызовы намеренно запрещены, real SQL/gates проверяются integration. */
function recoveryBoundary() {
  return new KafkaRecoveryService(
    {
      run: async () => {
        throw new Error('DB outside SDK unit scope');
      },
    },
    new QuarantineRepository(),
    new AuditService(new AuditRepository()),
    new QuarantineCrypto(randomBytes(32), 'unit-test'),
  );
}

test('505 stale pause poll cannot seek revoked assignment; group join resets pause', async () => {
  jest.useFakeTimers();
  const recovery = recoveryBoundary();
  const f = setup(recovery);
  let release!: (ready: boolean) => void;
  const waiting = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  jest.spyOn(recovery, 'ready').mockReturnValue(waiting);
  f.process.mockRejectedValue(new PartitionBlockedError('77'));
  try {
    await f.adapter.start();
    await f.invoke();
    await f.invoke();
    await jest.advanceTimersByTimeAsync(2000);
    expect(recovery.ready).toHaveBeenCalledTimes(1);
    await f.notify(f.consumer.events.REBALANCING);
    expect(f.adapter.ready).toBe(false);
    await f.notify(f.consumer.events.GROUP_JOIN);
    release(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(f.consumer.seek).not.toHaveBeenCalled();
    expect(f.consumer.resume).toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    release(false);
    await f.adapter.close();
    jest.useRealTimers();
  }
});

test('505 pause probe failure stops processing without offset acknowledgement', async () => {
  jest.useFakeTimers();
  const recovery = recoveryBoundary();
  const f = setup(recovery);
  jest.spyOn(recovery, 'ready').mockRejectedValue(new Error('fixture DB unavailable'));
  f.process.mockRejectedValue(new PartitionBlockedError('77'));
  try {
    await f.adapter.start();
    await f.invoke();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(f.adapter.failure).rejects.toThrow('halted');
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
    jest.useRealTimers();
  }
});

test('505 lag metrics report broker outage then recover without IDs or negative gauges', async () => {
  jest.useFakeTimers();
  const f = setup(recoveryBoundary());
  jest
    .spyOn(f.admin, 'fetchTopicOffsets')
    .mockRejectedValueOnce(new Error('fixture broker unavailable'));
  try {
    await f.adapter.start();
    expect(await renderMetrics()).toContain('wms_kafka_lag_scrape_success 0');
    jest.spyOn(f.admin, 'fetchOffsets').mockResolvedValueOnce([]);
    await jest.advanceTimersByTimeAsync(5000);
    const recovered = await renderMetrics();
    expect(recovered).toContain('wms_kafka_lag_scrape_success 1');
    expect(recovered).toContain('wms_kafka_partition_lag{partition="0"} 2');
    jest.spyOn(f.admin, 'fetchOffsets').mockResolvedValueOnce([
      {
        topic: 'warehouse.receiving.events',
        partitions: [0, 1, 2].map((partition) => ({ partition, offset: '9', metadata: null })),
      },
    ]);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await renderMetrics()).toContain('wms_kafka_partition_lag{partition="0"} 0');
  } finally {
    await f.adapter.close();
    jest.useRealTimers();
  }
});

test('505 stale batch after heartbeat starts no DB effect or offset commit', async () => {
  const f = setup();
  let stale = false;
  f.payload.isStale = () => stale;
  f.payload.heartbeat = async () => {
    stale = true;
  };
  try {
    await f.adapter.start();
    await f.invoke();
    expect(f.process).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
  }
});

test('505 stopped batch starts no new record', async () => {
  const f = setup();
  f.payload.isRunning = () => false;
  try {
    await f.adapter.start();
    await f.invoke();
    expect(f.process).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
  }
});

test('505 startup waits for cold coordinator without joining or changing offsets early', async () => {
  const f = setup();
  const loading = Object.assign(new Error('PRIVATE_SDK_TEXT'), { type: 'GROUP_LOAD_IN_PROGRESS' });
  jest.spyOn(f.admin, 'fetchOffsets').mockRejectedValueOnce(loading);
  try {
    await f.adapter.start();
    expect(f.admin.fetchOffsets).toHaveBeenCalledTimes(2);
    expect(f.consumer.run).toHaveBeenCalledTimes(1);
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    await f.adapter.close();
  }
});

test('506 coordinator deadline refuses startup without joining or acknowledging offsets', async () => {
  const f = setup();
  // Управляем монотонными часами, а не ждём реальные15s. Coordinator остаётся
  // недоступным до deadline: это STOP condition cutover, а не разрешение открыть запись.
  const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
  jest.spyOn(f.admin, 'fetchOffsets').mockImplementation(async () => {
    clock.mockReturnValue(15000);
    throw Object.assign(new Error('PRIVATE_SDK_TEXT'), { type: 'GROUP_LOAD_IN_PROGRESS' });
  });
  try {
    await expect(f.adapter.start()).rejects.toThrow('Kafka coordinator startup timed out');
    expect(f.adapter.ready).toBe(false);
    expect(f.consumer.connect).not.toHaveBeenCalled();
    expect(f.consumer.subscribe).not.toHaveBeenCalled();
    expect(f.consumer.run).not.toHaveBeenCalled();
    expect(f.process).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
    await f.adapter.close();
  }
});

test('505 startup does not retry auth errors and SDK diagnosis never echoes raw message', async () => {
  const { kafkaFailureCode } = await import('@backend/infrastructure/kafka-consumer/kafka-startup');
  const f = setup();
  const denied = Object.assign(new Error('PRIVATE_SDK_TEXT'), {
    type: 'GROUP_AUTHORIZATION_FAILED',
  });
  jest.spyOn(f.admin, 'fetchOffsets').mockRejectedValue(denied);
  try {
    await expect(f.adapter.start()).rejects.toBe(denied);
    expect(f.consumer.run).not.toHaveBeenCalled();
    expect(kafkaFailureCode({ message: 'SECRET', cause: denied })).toBe(
      'GROUP_AUTHORIZATION_FAILED',
    );
    expect(kafkaFailureCode(new Error('SECRET'))).toBe('KAFKA_FAILURE');
  } finally {
    await f.adapter.close();
  }
});
