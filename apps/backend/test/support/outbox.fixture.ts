/** @file Синтетический append DTO из contract fixture; никаких SQL/доменной логики или файлового I/O в transaction callback. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReceivingPostedPayload } from '@backend/shared/events/dto/event.dto';
import type { AppendEventDto } from '@backend/infrastructure/outbox/dto/append-event.dto';

// Файл читается при загрузке suite, до открытия транзакций.
const example = JSON.parse(
  readFileSync(resolve('../../docs/contracts/examples/receiving.receipt-posted.v1.json'), 'utf8'),
) as import('@backend/shared/events/generated/event-types').ReceivingPostedV1;

/** Новый независимый payload на вызов; generated eventId/version намеренно не передаются writer. */
export function outboxFixture(
  overrides: Partial<AppendEventDto & { payload: ReceivingPostedPayload }> = {},
): AppendEventDto & { payload: ReceivingPostedPayload } {
  const { eventId, aggregateVersion, ...input } = structuredClone(example);
  const aggregateId = randomUUID();
  return {
    ...input,
    aggregateId,
    payload: { ...input.payload, receiptId: aggregateId },
    ...overrides,
  };
}
