/** @file KafkaJS adapter: mTLS, one in-flight transactional send и stable broker fencing; никакого SQL. */
import { Kafka, logLevel, type Producer, type Admin } from 'kafkajs';
import { kafkaRoute } from '../../shared/events/kafka-route';
export { kafkaRoute } from '../../shared/events/kafka-route';
import type { KnownEvent } from '../../shared/events/dto/event.dto';
import type { EventTransport } from '../../shared/transport/event-transport.port';
import { kafkaTopology } from '../../shared/events/generated/kafka-topology';
import type { PublisherConfig } from './publisher.config';
/** Новый экземпляр принадлежит одному process lifetime; после uncertain/fatal ошибки не переиспользуется. */
export class KafkaEventTransport implements EventTransport {
  private readonly producer: Producer;
  private readonly admin: Admin;
  constructor(config: PublisherConfig) {
    const kafka = new Kafka({
      clientId: 'warehouse-outbox-publisher',
      brokers: config.brokers,
      // mTLS проверяет broker и предъявляет client certificate. Значения PEM не попадают в logs.
      ssl: config.ssl,
      // Raw SDK errors могут содержать адреса/config: наружу идут только наши статические reason codes.
      logLevel: logLevel.NOTHING,
      connectionTimeout: config.requestTimeoutMs,
      requestTimeout: config.requestTimeoutMs,
      enforceRequestTimeout: true,
      retry: { retries: 1, initialRetryTime: 100, maxRetryTime: 1000 },
    });
    // Ограниченные retries намеренны: at least once + fail-stop, не EOS DB+Kafka.
    this.producer = kafka.producer({
      // ID один на логический publisher, не на Pod/revision. Новый epoch с тем же ID
      // блокирует старый producer при новой transaction. Consumers обязаны read_committed,
      // чтобы не применять записи незавершённой/отменённой transaction старого владельца.
      transactionalId: config.transactionalId,
      // Идемпотентность Kafka ограничивает повторы внутри producer protocol. Она не связывает
      // broker commit с PostgreSQL commit и не исключает duplicate после рестарта процесса.
      idempotent: true,
      // Service публикует по одному событию; SDK также не должен распараллеливать его запросы.
      maxInFlightRequests: 1,
      transactionTimeout: 30000,
      // Ошибка имени не должна создавать новый topic с настройками broker по умолчанию.
      allowAutoTopicCreation: false,
      retry: { retries: 1 },
    });
    this.admin = kafka.admin();
  }
  /** Все topics должны быть provisioned до включения процесса; автосоздания нет. */
  async connect(): Promise<void> {
    await this.admin.connect();
    const topics = [...new Set(Object.values(kafkaTopology).map((r) => r.topic))];
    // До первого claim все потоки должны существовать с согласованным числом partitions.
    // Startup check не разрешает оператору менять topology во время работающего publisher.
    const metadata = await this.admin.fetchTopicMetadata({ topics });
    if (
      metadata.topics.length !== topics.length ||
      metadata.topics.some((t) => t.partitions.length !== 3)
    )
      throw new Error('Publisher topology mismatch');
    await this.producer.connect();
  }
  /** send ack недостаточен: завершение только после transaction commit ack, неизвестный исход не превращается в success. */
  async publish(event: KnownEvent): Promise<void> {
    const transaction = await this.producer.transaction();
    try {
      const { topic, key, partition } = kafkaRoute(event);
      await transaction.send({
        topic,
        // all: подтверждают текущие in-sync replicas. При RF1/ISR1 в dev это один broker, не HA.
        acks: -1,
        messages: [
          {
            key,
            partition,
            // Envelope уже проверен service. Не генерируем новый eventId/версию и не
            // оборачиваем payload: при повторе consumer должен распознать исходный факт.
            value: JSON.stringify(event),
            headers: {
              'content-type': 'application/json',
              'x-event-type': event.type,
              'x-schema-version': String(event.schemaVersion),
            },
          },
        ],
      });
      // send ack подтверждает запись в незавершённую Kafka transaction. Только commit ack
      // разрешает caller начать SQL completion; при этом отдельного atomic commit PG+Kafka нет.
      await transaction.commit();
    } catch {
      // Abort best effort не доказывает отсутствие commit. Caller оставляет delivery для retry и завершает process.
      try {
        await transaction.abort();
      } catch {
        /* Unknown transaction outcome остаётся unknown. */
      }
      throw new Error('Kafka publication not confirmed');
    }
  }
  /** Оба клиента закрываются даже после failed startup; ошибки cleanup не скрываются. */
  async close(): Promise<void> {
    try {
      await this.producer.disconnect();
    } finally {
      await this.admin.disconnect();
    }
  }
}
