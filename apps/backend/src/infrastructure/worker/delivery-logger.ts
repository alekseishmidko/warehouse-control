/** @file Безопасная диагностика доставки только после commit; token/payload отсутствуют в общем logger contract. */
import type { DeliveryDiagnostic } from '../../shared/diagnostics/delivery-diagnostic';
import { logEvent } from '../logging/runtime-logger';
/** Стадия определяется серверным service, неизвестная стадия считается stale. */
export function logDelivery(status: string, d: DeliveryDiagnostic): void {
  const event =
    status === 'persistence-failed'
      ? 'delivery.persistence_failed'
      : status === 'claimed'
        ? 'delivery.claimed'
        : status === 'completed'
          ? 'delivery.completed'
          : status === 'retry'
            ? 'delivery.retry'
            : status === 'dead'
              ? 'delivery.dead'
              : 'delivery.stale';
  logEvent(event, {
    module: 'worker',
    correlationId: d.correlationId ?? undefined,
    eventId: d.eventId,
    aggregateId: d.stream.aggregateId,
    destination: d.consumer,
    attempt: d.attempt,
    errorCode: d.lastError ?? undefined,
  });
}
