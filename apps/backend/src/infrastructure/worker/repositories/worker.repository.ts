/** @file PostgreSQL worker protocol: parameterized SQL, один порядок locks и обязательный borrowed context. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { DeliveryClaim } from '../dto/delivery.dto';
import type { WorkerConfig } from '../worker.config';
import { PermanentDeliveryError } from '../delivery-policy';

/** Locked immutable event identity и delivery state; наружу отдаётся только внутри одного context. */
export interface LockedDelivery { envelope: unknown; attempts: number; }

/** Внутренний provider worker; pool/run/commit отсутствуют, все методы требуют действующий context. */
@Injectable()
export class WorkerRepository {
  /** PostgreSQL 17 ограничивает всю transaction, включая idle JS handler, а не только один statement. */
  async boundTransaction(context: TransactionContext, timeoutMs: number): Promise<void> {
    await transactionClient(context).execute(sql`select set_config('transaction_timeout', ${String(timeoutMs)}, true),
      set_config('statement_timeout', ${String(timeoutMs)}, true)`);
  }

  /**
   * Claim следующей версии каждого eligible stream под SKIP LOCKED; срок берётся из DB clock.
   * Не пропускает retry/dead predecessor. Row locks stream/delivery держатся только до commit claim.
   * Expired crash с исчерпанным budget переводится в dead без новой попытки эффекта.
   */
  async claim(context: TransactionContext, destinations: string[], config: WorkerConfig): Promise<DeliveryClaim[]> {
    if (!destinations.length) return [];
    const tx = transactionClient(context);
    const selected = await tx.execute<{ event_id: string; destination: string; aggregate_type: string; aggregate_id: string; version: string; attempts: number }>(sql`
      select d.event_id,s.destination,s.aggregate_type,s.aggregate_id,e.aggregate_version::text as version,d.attempts
      from delivery_streams s
      join outbox_events e on e.aggregate_type=s.aggregate_type and e.aggregate_id=s.aggregate_id
        and e.aggregate_version=s.last_completed_version+1
      join outbox_deliveries d on d.event_id=e.event_id and d.destination=s.destination
      where s.destination in (${sql.join(destinations.map(value => sql`${value}`), sql`, `)})
        and (s.lease_until is null or s.lease_until<=clock_timestamp())
        and ((d.status in ('pending','retry') and d.available_at<=clock_timestamp())
          or (d.status='processing' and d.lease_until<=clock_timestamp()))
      order by d.available_at,s.aggregate_id limit ${config.batchSize}
      for update of s,d skip locked`);
    const claims: DeliveryClaim[] = [];
    for (const row of selected.rows) {
      const claim = Object.freeze({ eventId: row.event_id, destination: row.destination, aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id, version: Number(row.version), token: randomUUID() });
      if (row.attempts >= config.maxAttempts) {
        await tx.execute(sql`update outbox_deliveries set status='dead',lease_until=null,lease_token=null,last_error='ATTEMPTS_EXHAUSTED'
          where event_id=${claim.eventId} and destination=${claim.destination}`);
        await this.releaseStream(context, claim); continue;
      }
      // Одинаковые token/deadline на stream и delivery. Все selected locks уже
      // удерживаются: два claim transactions не могут выдать одновременно одного владельца.
      const lease = await tx.execute<{ until: Date }>(sql`update delivery_streams set lease_token=${claim.token},
        lease_until=date_trunc('milliseconds',clock_timestamp())+${config.leaseMs}*interval '1 millisecond'
        where destination=${claim.destination} and aggregate_type=${claim.aggregateType} and aggregate_id=${claim.aggregateId}
        returning lease_until as until`);
      await tx.execute(sql`update outbox_deliveries set status='processing',attempts=attempts+1,
        lease_token=${claim.token},lease_until=${lease.rows[0].until}
        where event_id=${claim.eventId} and destination=${claim.destination}`);
      claims.push(claim);
    }
    return claims;
  }

  /**
   * Повторно блокирует stream+delivery; свежесть проверяется ПОСЛЕ получения locks.
   * При долгой активной обработке reclaim пропускает lock даже после expiry.
   * @returns null для completed, stale/expired token либо cursor, который уже продвинут.
   */
  async lock(context: TransactionContext, claim: DeliveryClaim): Promise<LockedDelivery | null> {
    const result = await transactionClient(context).execute<{ envelope: unknown; attempts: number; valid: boolean }>(sql`
      select e.envelope,d.attempts,(s.lease_token=${claim.token}::uuid and d.lease_token=${claim.token}::uuid
        and s.lease_until>clock_timestamp() and d.lease_until>clock_timestamp()
        and d.status='processing' and s.last_completed_version=${claim.version - 1}) as valid
      from delivery_streams s join outbox_events e on e.aggregate_type=s.aggregate_type and e.aggregate_id=s.aggregate_id
      join outbox_deliveries d on d.event_id=e.event_id and d.destination=s.destination
      where s.destination=${claim.destination} and s.aggregate_type=${claim.aggregateType} and s.aggregate_id=${claim.aggregateId}
        and e.event_id=${claim.eventId} and e.aggregate_version=${claim.version}
      for update of s,d`);
    const row = result.rows[0]; return row?.valid ? { envelope: row.envelope, attempts: row.attempts } : null;
  }

  /** Создаёт/блокирует consumer cursor и проверяет dedup marker до handler; gap не маскируется успешным ack. */
  async prepareConsumer(context: TransactionContext, claim: DeliveryClaim): Promise<boolean> {
    const tx = transactionClient(context);
    await tx.execute(sql`insert into consumer_streams(consumer_name,aggregate_type,aggregate_id)
      values(${claim.destination},${claim.aggregateType},${claim.aggregateId}) on conflict do nothing`);
    const cursor = await tx.execute<{ version: string }>(sql`select last_processed_version::text as version from consumer_streams
      where consumer_name=${claim.destination} and aggregate_type=${claim.aggregateType} and aggregate_id=${claim.aggregateId} for update`);
    const marker = await tx.execute(sql`select 1 from processed_events where consumer_name=${claim.destination} and event_id=${claim.eventId}`);
    const previous = Number(cursor.rows[0].version); const duplicate = marker.rows.length > 0;
    if (duplicate ? previous < claim.version : previous !== claim.version - 1) throw new PermanentDeliveryError('CURSOR_MISMATCH');
    return duplicate;
  }

  /** INSERT marker выполняется после awaited handler, но в той же transaction; unique conflict не скрывается. */
  async markProcessed(context: TransactionContext, claim: DeliveryClaim): Promise<void> {
    await transactionClient(context).execute(sql`insert into processed_events(consumer_name,event_id) values(${claim.destination},${claim.eventId})`);
  }

  /** Эффект/marker/оба cursors/completion подтверждаются одним commit. После lock token нельзя перехватить. */
  async complete(context: TransactionContext, claim: DeliveryClaim): Promise<void> {
    const tx = transactionClient(context);
    // GREATEST сохраняет consumer cursor при controlled повторе старого event с уже имеющимся marker.
    await tx.execute(sql`update consumer_streams set last_processed_version=greatest(last_processed_version,${claim.version})
      where consumer_name=${claim.destination} and aggregate_type=${claim.aggregateType} and aggregate_id=${claim.aggregateId}`);
    await tx.execute(sql`update outbox_deliveries set status='completed',completed_at=clock_timestamp(),last_error=null,lease_token=null,lease_until=null
      where event_id=${claim.eventId} and destination=${claim.destination} and lease_token=${claim.token}`);
    await tx.execute(sql`update delivery_streams set last_completed_version=${claim.version},lease_token=null,lease_until=null
      where destination=${claim.destination} and aggregate_type=${claim.aggregateType} and aggregate_id=${claim.aggregateId} and lease_token=${claim.token}`);
  }

  /** После rollback отдельная token-checked transaction сохраняет только безопасный code/retry deadline. */
  async fail(context: TransactionContext, claim: DeliveryClaim, dead: boolean, code: string, delayMs: number): Promise<void> {
    await transactionClient(context).execute(sql`update outbox_deliveries set status=${dead ? 'dead' : 'retry'},last_error=${code},
      available_at=clock_timestamp()+${delayMs}*interval '1 millisecond',lease_token=null,lease_until=null
      where event_id=${claim.eventId} and destination=${claim.destination} and lease_token=${claim.token}`);
    await this.releaseStream(context, claim);
  }

  /** Освобождает scheduling lease под уже удерживаемым stream lock; cursor при failure не меняется. */
  private async releaseStream(context: TransactionContext, claim: DeliveryClaim): Promise<void> {
    await transactionClient(context).execute(sql`update delivery_streams set lease_token=null,lease_until=null
      where destination=${claim.destination} and aggregate_type=${claim.aggregateType} and aggregate_id=${claim.aggregateId}`);
  }
}
