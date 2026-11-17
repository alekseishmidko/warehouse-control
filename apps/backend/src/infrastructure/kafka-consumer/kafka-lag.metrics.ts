/** @file Bounded Kafka lag observer: один cached probe вне DB transaction/scrape; source identifiers не становятся labels. */
import type { Admin } from 'kafkajs';
import { registerKafkaMetrics } from '../metrics/runtime-metrics';
import { kafkaTopology } from '../../shared/events/generated/kafka-topology';
import { PUTAWAY_DESTINATION } from '../outbox/outbox-destinations';
/** Admin принадлежит consumer, уже connected. Возвращённый stop прекращает scheduling и снимает getter.
 * Сбой probe меняет только scrape status, не Kafka offset и не business transaction. */
export function startKafkaLagMetrics(admin: Admin): () => void {
  let closed = false,
    busy = false,
    success = 0,
    updated = 0;
  const lags = new Map<number, bigint>();
  const unregister = registerKafkaMetrics(() => [
    'wms_kafka_lag_scrape_success ' + success,
    'wms_kafka_lag_sample_age_seconds ' +
      (updated ? Math.max(0, (Date.now() - updated) / 1000) : 0),
    ...[0, 1, 2].map(
      (partition) =>
        `wms_kafka_partition_lag{partition="${partition}"} ${lags.get(partition) ?? 0n}`,
    ),
  ]);
  const unavailable = () => {
    success = 0;
  };
  const poll = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const [ends, committed] = await Promise.all([
        admin.fetchTopicOffsets(kafkaTopology.receipt.topic),
        admin.fetchOffsets({ groupId: PUTAWAY_DESTINATION, topics: [kafkaTopology.receipt.topic] }),
      ]);
      for (const p of ends) {
        const raw =
          committed[0]?.partitions.find((c) => c.partition === p.partition)?.offset ?? '-1';
        const start = raw === '-1' ? BigInt(p.low) : BigInt(raw);
        const lag = BigInt(p.high) - start;
        lags.set(p.partition, lag > 0n ? lag : 0n);
      }
      success = 1;
      updated = Date.now();
    } catch {
      unavailable();
    } finally {
      busy = false;
    }
  };
  const schedule = () => {
    void poll().catch(unavailable);
  };
  schedule();
  const timer = setInterval(schedule, 5000);
  timer.unref();
  return () => {
    closed = true;
    clearInterval(timer);
    unregister();
  };
}
