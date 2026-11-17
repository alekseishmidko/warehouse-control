/** @file Durable Kafka failure protocol; partition advisory lock сериализует gate/effect/recovery, quota lock — суммарный объём. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { transactionClient } from '../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { KafkaAddress, QuarantineSnapshot } from '../dto/quarantine.dto';
import type { SealedRecord } from '../quarantine-crypto';
/** Gate не является successful skip; вызывающий обязан pause/seek исходную позицию без ack. */
export class PartitionBlockedError extends Error {
  constructor(readonly offset: string) {
    super('Kafka partition blocked');
  }
}
/** Private repository Kafka capability; внешние modules не получают его через exports. */
@Injectable()
export class QuarantineRepository {
  /** Общий lock для business transaction и последующего failure/recovery. Topic фиксирован topology. */
  async lock(context: TransactionContext, address: KafkaAddress): Promise<void> {
    if (
      address.topic !== 'warehouse.receiving.events' ||
      !Number.isInteger(address.partition) ||
      address.partition < 0 ||
      address.partition > 2 ||
      !/^(0|[1-9][0-9]{0,18})$/.test(address.offset) ||
      BigInt(address.offset) > 9223372036854775807n
    )
      throw new Error('Invalid Kafka address');
    await transactionClient(context).execute(
      sql`select pg_advisory_xact_lock(505,${address.partition})`,
    );
  }
  /** До каждого эффекта проверяется самый ранний unresolved offset. Earlier replay разрешён, обгон — нет. */
  async check(context: TransactionContext, address: KafkaAddress): Promise<void> {
    await this.lock(context, address);
    const result = await transactionClient(context).execute<{
      offset: string;
      ready: boolean;
    }>(sql`select source_offset::text as offset,(status='retry' and available_at<=clock_timestamp()) ready from kafka_quarantine
      where topic=${address.topic} and partition=${address.partition} and status<>'resolved' order by source_offset limit 1`);
    const row = result.rows[0];
    if (
      row &&
      (BigInt(row.offset) < BigInt(address.offset) || (row.offset === address.offset && !row.ready))
    )
      throw new PartitionBlockedError(row.offset);
  }
  /** Сохраняет failure только после rollback handler; immutable bytes повторно не перезаписываются. */
  async fail(
    context: TransactionContext,
    address: KafkaAddress,
    sealed: SealedRecord,
    code: string,
    permanent: boolean,
    eventId: string | null,
  ): Promise<{
    id: string;
    status: 'retry' | 'quarantine' | 'resolved';
    attempts: number;
    errorCode: string;
  }> {
    await this.lock(context, address);
    const tx = transactionClient(context);
    // Fixed порядок partition → global quota; cleanup берёт только quota, не обратный partition lock.
    await tx.execute(sql`select pg_advisory_xact_lock(505,100)`);
    const old = await tx.execute<{
      id: string;
      attempts: number;
      retry_base: number;
      digest: string;
      status: string;
      error_code: string;
    }>(
      sql`select id,attempts,retry_base,digest,status,error_code from kafka_quarantine where topic=${address.topic} and partition=${address.partition} and source_offset=${address.offset}`,
    );
    const row = old.rows[0];
    if (row && row.digest !== sealed.digest) throw new Error('Kafka source identity changed');
    if (row?.status === 'resolved')
      return { id: row.id, status: 'resolved', attempts: row.attempts, errorCode: row.error_code }; // Uncertain commit не меняет success; source digest всё равно обязателен.
    if (!row) {
      const size = await tx.execute<{ bytes: string }>(
        sql`select coalesce(sum(raw_bytes),0)::text bytes from kafka_quarantine`,
      );
      if (Number(size.rows[0].bytes) + sealed.bytes > 268435456)
        throw new Error('Quarantine storage quota exceeded');
    }
    const attempts = (row?.attempts ?? 0) + 1;
    const dead =
      row?.status === 'quarantine' || permanent || attempts - (row?.retry_base ?? 0) >= 3;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(attempts - (row?.retry_base ?? 0) - 1, 5));
    const effectiveCode = row?.status === 'quarantine' ? row.error_code : code;
    const id = row?.id ?? randomUUID();
    if (row)
      await tx.execute(
        sql`update kafka_quarantine set attempts=${attempts},status=${dead ? 'quarantine' : 'retry'},error_code=${effectiveCode},available_at=clock_timestamp()+${wait}*interval '1 millisecond' where topic=${address.topic} and partition=${address.partition} and source_offset=${address.offset}`,
      );
    else
      await tx.execute(sql`insert into kafka_quarantine(id,topic,partition,source_offset,ciphertext,nonce,tag,key_id,digest,raw_bytes,event_id,error_code,status,attempts,available_at)
      values(${id},${address.topic},${address.partition},${address.offset},${sealed.ciphertext},${sealed.nonce},${sealed.tag},${sealed.keyId},${sealed.digest},${sealed.bytes},${eventId},${code},${dead ? 'quarantine' : 'retry'},1,clock_timestamp()+${wait}*interval '1 millisecond')`);
    return { id, status: dead ? 'quarantine' : 'retry', attempts, errorCode: effectiveCode };
  }
  /** Вызывается в effect transaction. Crash после DB commit оставляет resolved и разрешает duplicate replay. */
  async resolve(context: TransactionContext, address: KafkaAddress): Promise<void> {
    await transactionClient(context).execute(
      sql`update kafka_quarantine set status='resolved',resolved_at=clock_timestamp() where topic=${address.topic} and partition=${address.partition} and source_offset=${address.offset} and status='retry'`,
    );
  }
  /** Admin role проверяется внутри той же transaction до чтения ciphertext или изменения gate. */
  async authorize(context: TransactionContext): Promise<void> {
    const row = await transactionClient(context).execute<{ allowed: boolean }>(
      sql`select pg_has_role(current_user,'warehouse_outbox_admin','member') allowed`,
    );
    if (!row.rows[0].allowed) throw new Error('Kafka recovery admin role required');
  }
  /** Только safe scalar fields; ciphertext отдельно читается исключительно export path. */
  async inspect(context: TransactionContext, id: string): Promise<QuarantineSnapshot> {
    const r = await transactionClient(context).execute<QuarantineSnapshot>(
      sql`select id,topic,partition,source_offset::text as offset,status,attempts,retry_base,error_code,digest,raw_bytes,event_id,(status='retry' and available_at<=clock_timestamp()) ready from kafka_quarantine where id=${id}::uuid`,
    );
    if (!r.rows[0]) throw new Error('Quarantine record not found');
    return r.rows[0];
  }
  /** Retry не меняет source/cursor; новый budget открывается только под lock и audit владельца service. */
  async retry(context: TransactionContext, row: QuarantineSnapshot): Promise<void> {
    await this.lock(context, row);
    const current = await this.inspect(context, row.id);
    if (current.attempts >= 2147483647) throw new Error('Kafka retry attempt limit reached');
    if (current.status !== 'quarantine') throw new Error('Quarantine retry state invalid');
    await transactionClient(context).execute(
      sql`update kafka_quarantine set status='retry',retry_base=attempts,available_at=clock_timestamp() where id=${row.id}`,
    );
  }
  /** Ciphertext возвращается trusted admin service, не inspect response. */
  async sealed(context: TransactionContext, id: string): Promise<SealedRecord> {
    const r = await transactionClient(context).execute<SealedRecord>(
      sql`select ciphertext,nonce,tag,key_id as "keyId",digest,raw_bytes as bytes from kafka_quarantine where id=${id}::uuid for share`,
    );
    if (!r.rows[0]) throw new Error('Quarantine record not found');
    return r.rows[0];
  }
  /** Очищает только resolved старше7дней; audit пишется вызывающим service в той же transaction. */
  async cleanup(context: TransactionContext): Promise<number> {
    const tx = transactionClient(context);
    await tx.execute(sql`select pg_advisory_xact_lock(505,100)`);
    const rows = await tx.execute(
      sql`delete from kafka_quarantine where status='resolved' and resolved_at<clock_timestamp()-interval '7 days' returning id`,
    );
    return rows.rows.length;
  }
}
