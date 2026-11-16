/** @file KafkaJS read_committed adapter: sequential batches, bounded heartbeat guard и DB-before-offset protocol. */
import { Kafka, logLevel, type Consumer, type EachBatchPayload, type Admin } from 'kafkajs';
import { setTimeout as delay } from 'node:timers/promises';
import { logEvent } from '../logging/runtime-logger';
import { classifyDeliveryError } from '../worker/delivery-policy';
import type { ConsumerConfig } from './consumer.config';
import type { KafkaMessageService } from './services/kafka-message.service';
import { kafkaTopology } from '../../shared/events/generated/kafka-topology';
import { PUTAWAY_DESTINATION } from '../outbox/outbox-destinations';
/** Один instance — один process lifetime. Fatal message не пропускается и не restart-ится бесконечно SDK. */
export class KafkaApplicationConsumer {
  private readonly consumer: Consumer;
  private readonly admin: Admin;
  private epoch = 0;
  private assigned = false;
  private joined!: () => void;
  private readonly firstJoin = new Promise<void>((resolve) => {
    this.joined = resolve;
  });
  /** Readiness требует assignment; liveness не зависит от broker. */
  get ready(): boolean {
    return this.assigned && !this.stopped && !this.failed;
  }
  private stopped = false;
  private failed = false;
  private rejectFailure!: (error: Error) => void;
  /** Владелец process обязан await failure вместе с signal. Ошибка содержит только статический текст. */
  readonly failure: Promise<never>;
  constructor(
    private readonly config: ConsumerConfig,
    private readonly messages: KafkaMessageService,
  ) {
    this.failure = new Promise<never>((_, reject) => {
      this.rejectFailure = reject;
    });
    // Handler подключается сразу: failure может наступить между startup и ожиданием process loop.
    void this.failure.catch(() => undefined);
    const kafka = new Kafka({
      clientId: 'warehouse-inventory-putaway',
      brokers: config.brokers,
      ssl: config.ssl,
      logLevel: logLevel.NOTHING,
      requestTimeout: 5000,
      connectionTimeout: 5000,
      retry: { retries: 5, initialRetryTime: 100, maxRetryTime: 3000 },
    });
    this.admin = kafka.admin();
    this.consumer = kafka.consumer({
      groupId: PUTAWAY_DESTINATION,
      readUncommitted: false,
      allowAutoTopicCreation: false,
      sessionTimeout: 15000,
      heartbeatInterval: 1000,
      rebalanceTimeout: 30000,
      maxBytesPerPartition: 1024 * 1024,
      maxBytes: 3 * 1024 * 1024,
      retry: { retries: 5, restartOnFailure: async () => false },
    });
    // Instrumentation не является synchronous revoke API. Heartbeat error ниже отзывает
    // ownership непосредственно; epoch дополнительно защищает от смены assignment между awaits.
    this.consumer.on(this.consumer.events.REBALANCING, () => {
      this.epoch++;
      this.assigned = false;
    });
    this.consumer.on(this.consumer.events.GROUP_JOIN, () => {
      this.epoch++;
      this.assigned = true;
      this.joined();
    });
    this.consumer.on(this.consumer.events.CRASH, () => this.fail());
  }
  /** Connect/subscribe с начала при отсутствии offset; retained DB cursor никогда не инициализируется из Kafka offset. */
  async start(): Promise<void> {
    await this.admin.connect();
    const metadata = await this.admin.fetchTopicMetadata({ topics: [kafkaTopology.receipt.topic] });
    if (metadata.topics.length !== 1 || metadata.topics[0].partitions.length !== 3)
      throw new Error('Consumer topology mismatch');
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [kafkaTopology.receipt.topic], fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently: 1,
      eachBatch: (payload) => this.batch(payload),
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.firstJoin,
        this.failure,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Consumer assignment timed out')), 45000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /** SIGTERM запрещает новые records сразу; current transaction проверяет stopped до commit. */
  stop(): void {
    this.stopped = true;
    this.epoch++;
  }
  /** Disconnect ждёт текущий batch; hard deadline задаёт entrypoint, а не неограниченный shutdown. */
  async close(): Promise<void> {
    this.stop();
    try {
      await this.consumer.disconnect();
    } finally {
      await this.admin.disconnect();
    }
  }
  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    this.epoch++;
    this.rejectFailure(new Error('Kafka consumer halted without offset acknowledgement'));
  }
  /** Ни resolveOffset, ни commitOffsetsIfNecessary не вызываются до successful PostgreSQL commit. */
  private async batch(payload: EachBatchPayload): Promise<void> {
    const { batch, heartbeat, isRunning, isStale, resolveOffset } = payload;
    const epoch = this.epoch;
    let revoked = false;
    const owned = () =>
      !this.stopped &&
      !this.failed &&
      !revoked &&
      epoch === this.epoch &&
      isRunning() &&
      !isStale();
    const beat = async () => {
      try {
        await heartbeat();
      } catch {
        revoked = true;
        this.assigned = false;
        throw new Error('Kafka ownership lost');
      }
    };
    for (const message of batch.messages) {
      if (!owned()) return;
      const wake = new AbortController();
      let monitorError = false;
      // Monitor — sibling DB operation, создан ДО callback runner. Kafka I/O никогда
      // не ожидается из transaction; локальный ownership check остаётся синхронным.
      const monitor = (async () => {
        try {
          while (!wake.signal.aborted) {
            await delay(1000, undefined, { signal: wake.signal });
            if (!wake.signal.aborted) await beat();
          }
        } catch {
          if (!wake.signal.aborted || revoked) {
            revoked = true;
            monitorError = true;
          }
        }
      })();
      try {
        await beat();
        if (!owned()) return;
        await this.messages.process(
          batch.topic,
          batch.partition,
          message,
          owned,
          this.config.transactionTimeoutMs,
        );
        // DB commit мог пройти прямо перед revoke: эффект допустим, но offset не ack-аем.
        await beat();
        if (!owned()) return;
        // BigInt сохраняет Kafka int64; JS number округлил бы большой offset.
        // KafkaJS использует generation/member текущего batch: coordinator отклоняет stale generation.
        await this.consumer.commitOffsets([
          {
            topic: batch.topic,
            partition: batch.partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);
        resolveOffset(message.offset);
      } catch (error) {
        logEvent('consumer.halted', {
          module: 'worker',
          destination: PUTAWAY_DESTINATION,
          errorCode: classifyDeliveryError(error).code,
        });
        this.fail();
        throw new Error('Kafka batch halted');
      } finally {
        wake.abort();
        await monitor;
        if (monitorError) this.fail();
      }
    }
  }
}
