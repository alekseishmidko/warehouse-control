/** @file Private SQL provider: borrowed transaction client, guarded version upsert, event/delivery/stream INSERT. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { PreparedEvent } from '../../../shared/events/dto/event.dto';
import { transactionClient } from '../../database/postgres-transaction-runner';
import {
  deliveryStreams,
  outboxAggregateSequences,
  outboxDeliveries,
  outboxEvents,
} from '../outbox.schema';
import { MAX_AGGREGATE_VERSION, RECEIPT_DESTINATIONS } from '../outbox-destinations';

/** Не экспортируется Nest-модулем; DB pool и собственный commit здесь отсутствуют. */
@Injectable()
export class OutboxRepository {
  /**
   * Выдаёт следующую версию под row lock до завершения общей транзакции.
   * При отсутствии строки concurrent INSERT сериализуется PK; rollback отменяет и первое создание.
   * Guard исключает превышение безопасного диапазона без bigint→number потери точности.
   */
  async nextVersion(
    context: TransactionContext,
    aggregateType: string,
    aggregateId: string,
  ): Promise<number> {
    const [row] = await transactionClient(context)
      .insert(outboxAggregateSequences)
      .values({
        aggregateType,
        aggregateId,
        lastVersion: 1,
      })
      .onConflictDoUpdate({
        target: [outboxAggregateSequences.aggregateType, outboxAggregateSequences.aggregateId],
        set: { lastVersion: sql`${outboxAggregateSequences.lastVersion} + 1` },
        setWhere: sql`${outboxAggregateSequences.lastVersion} < ${MAX_AGGREGATE_VERSION}`,
      })
      .returning({ version: outboxAggregateSequences.lastVersion });
    if (!row) throw new Error('Outbox aggregate version limit exceeded');
    return row.version;
  }

  /** Сохраняет именно проверенный JSON через параметризованный cast; JSONB меняет форматирование, но не смысл snapshot. */
  async insert(context: TransactionContext, prepared: PreparedEvent): Promise<void> {
    const tx = transactionClient(context);
    const event = prepared.event;
    await tx.insert(outboxEvents).values({
      eventId: event.eventId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      envelope: sql`${prepared.message}::jsonb`,
    });
    // Только первая запись создаёт stream. Повторный append не сбрасывает cursor/lease.
    // Конфликт доставки намеренно не игнорируется: duplicate event не является успешным append.
    for (const destination of RECEIPT_DESTINATIONS) {
      await tx
        .insert(deliveryStreams)
        .values({ destination, aggregateType: event.aggregateType, aggregateId: event.aggregateId })
        .onConflictDoNothing();
      await tx.insert(outboxDeliveries).values({ eventId: event.eventId, destination });
    }
  }
}
