/** @file Единое deterministic routing событий: aggregateId key и закреплённый partition mapping ADR-0034. */
import { createHash } from 'node:crypto';
import type { KnownEvent } from './dto/event.dto';
import { kafkaTopology } from './generated/kafka-topology';
/** Явный partition не меняется после metadata refresh: SHA256(key UTF8), first uint32 BE mod3.
 * Менять алгоритм/число partitions без migration mapping запрещено: все версии UUID идут в один stream.
 */
export function kafkaRoute(event: KnownEvent): { topic: string; key: string; partition: number } {
  // Ключ принадлежит агрегату, а не событию: eventId/версия отправили бы его версии в разные partitions.
  // Lowercase устраняет различие двух записей одного PostgreSQL UUID. Topic зависит от aggregateType,
  // поэтому order-changed и shipping-changed одного заказа остаются в одном topic.
  const key = event.aggregateId.toLowerCase();
  return {
    topic: kafkaTopology[event.aggregateType].topic,
    key,
    // Явный partition исключает неявную смену алгоритма при обновлении SDK.
    // Число3 — часть протокола; увеличение partitions требует отдельного mapping/cutover плана.
    partition: createHash('sha256').update(key, 'utf8').digest().readUInt32BE(0) % 3,
  };
}
