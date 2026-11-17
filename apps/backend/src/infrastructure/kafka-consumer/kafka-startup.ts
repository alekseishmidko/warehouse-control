/** @file Cold-start coordinator readiness: read-only OffsetFetch до join, только bounded retries известных protocol states. */
import type { Admin } from 'kafkajs';
import { setTimeout as delay } from 'node:timers/promises';
import { PUTAWAY_DESTINATION } from '../outbox/outbox-destinations';
import { kafkaTopology } from '../../shared/events/generated/kafka-topology';
const codes = new Set([
  'GROUP_LOAD_IN_PROGRESS',
  'GROUP_COORDINATOR_NOT_AVAILABLE',
  'NOT_COORDINATOR_FOR_GROUP',
  'REBALANCE_IN_PROGRESS',
  'GROUP_AUTHORIZATION_FAILED',
  'TOPIC_AUTHORIZATION_FAILED',
  'UNKNOWN_SERVER_ERROR',
  'UNKNOWN_TOPIC_OR_PARTITION',
  'UNSUPPORTED_VERSION',
  'INVALID_REQUEST',
  'REQUEST_TIMED_OUT',
  'NETWORK_EXCEPTION',
]);
/** Диагностика не отражает SDK message/stack/config; unknown становится статическим KAFKA_FAILURE. */
export function kafkaFailureCode(error: unknown): string {
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if ('type' in error && typeof error.type === 'string' && codes.has(error.type))
      return error.type;
    if (!('cause' in error)) break;
    error = error.cause;
  }
  return 'KAFKA_FAILURE';
}
/** Topic metadata/Kafka Server started не доказывают готовность __consumer_offsets coordinator.
 * Читает offsets без resolveOffsets/setOffsets. Auth/config errors не превращаются в readiness retry. */
export async function waitForKafkaCoordinator(admin: Admin, stopped: () => boolean): Promise<void> {
  const deadline = performance.now() + 15000;
  while (!stopped()) {
    try {
      await admin.fetchOffsets({
        groupId: PUTAWAY_DESTINATION,
        topics: [kafkaTopology.receipt.topic],
      });
      return;
    } catch (error) {
      if (
        ![
          'GROUP_LOAD_IN_PROGRESS',
          'GROUP_COORDINATOR_NOT_AVAILABLE',
          'NOT_COORDINATOR_FOR_GROUP',
          'REBALANCE_IN_PROGRESS',
        ].includes(kafkaFailureCode(error))
      )
        throw error;
      if (performance.now() >= deadline) throw new Error('Kafka coordinator startup timed out');
      await delay(200);
    }
  }
}
