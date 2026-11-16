/** @file Общая durable consumer identity: retained event, marker и cursor; transport scheduling здесь отсутствует. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
import { canonicalSnapshotJson } from '../../../shared/serialization/canonical-json';
import { PermanentDeliveryError } from '../delivery-policy';

/** Оба transport используют эти таблицы под одним logical name; reset при cutover запрещён. */
@Injectable()
export class ConsumerRepository {
  /** Kafka не является новым источником фактов: принимаем только точный immutable envelope нашей retained БД.
   * Это также исключает переиспользование чужого eventId с изменённым payload после уже записанного marker. */
  async assertRetained(context: TransactionContext, event: KnownEvent): Promise<void> {
    const result = await transactionClient(context).execute<{ envelope: unknown }>(sql`
      select envelope from outbox_events where event_id=${event.eventId}`);
    if (
      !result.rows.length ||
      canonicalSnapshotJson(result.rows[0].envelope) !== canonicalSnapshotJson(event)
    )
      throw new PermanentDeliveryError('IDENTITY_MISMATCH');
  }
  /** INSERT конфликт сериализует absent-key race; FOR UPDATE удерживает cursor до общего commit. */
  async prepare(
    context: TransactionContext,
    consumer: string,
    event: KnownEvent,
  ): Promise<boolean> {
    const tx = transactionClient(context);
    await tx.execute(sql`insert into consumer_streams(consumer_name,aggregate_type,aggregate_id)
      values(${consumer},${event.aggregateType},${event.aggregateId}) on conflict do nothing`);
    const cursor = await tx.execute<{ version: string }>(sql`
      select last_processed_version::text as version from consumer_streams
      where consumer_name=${consumer} and aggregate_type=${event.aggregateType} and aggregate_id=${event.aggregateId} for update`);
    const marker = await tx.execute(
      sql`select 1 from processed_events where consumer_name=${consumer} and event_id=${event.eventId}`,
    );
    const previous = Number(cursor.rows[0].version);
    const duplicate = marker.rows.length > 0;
    // Нельзя принять N+1 без N или старую версию без marker, даже если cursor уже впереди.
    if (duplicate ? previous < event.aggregateVersion : previous !== event.aggregateVersion - 1)
      throw new PermanentDeliveryError('CURSOR_MISMATCH');
    return duplicate;
  }
  /** Вызывается только после awaited handler в том же context. Ошибка INSERT/UPDATE откатывает весь эффект. */
  async complete(context: TransactionContext, consumer: string, event: KnownEvent): Promise<void> {
    const tx = transactionClient(context);
    await tx.execute(
      sql`insert into processed_events(consumer_name,event_id) values(${consumer},${event.eventId})`,
    );
    await tx.execute(sql`update consumer_streams set last_processed_version=${event.aggregateVersion}
      where consumer_name=${consumer} and aggregate_type=${event.aggregateType} and aggregate_id=${event.aggregateId}`);
  }
}
