/** @file Private SQL shipment документов: один borrowed context, порядок order → shipment. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
/** Не изменяет чужие balances/allocations; draft не резервирует повторно. */
@Injectable()
export class ShipmentsRepository {
  /** Читает метаданные до ACL либо блокирует header после order lock. */
  async findShipment(c: TransactionContext, id: string, lock = false) {
    return (
      await transactionClient(c).execute<{
        id: string;
        order_id: string;
        status: string;
        reason_code: string;
        posted_at: string | null;
      }>(sql`select * from shipments where id=${id} ${lock ? sql`for update` : sql``}`)
    ).rows[0];
  }
  /** Immutable строки сортируются по id; порядок stock locks задаёт inventory отдельно. */
  async listLines(c: TransactionContext, id: string) {
    return (
      await transactionClient(c).execute<{ id: string; allocation_id: string; quantity: number }>(
        sql`select * from shipment_lines where shipment_id=${id} order by id`,
      )
    ).rows;
  }
  /** Создаёт draft и полный состав в caller transaction; нет отдельного commit. */
  async createDraft(
    c: TransactionContext,
    id: string,
    orderId: string,
    reason: string,
    lines: { id: string; allocationId: string; quantity: number }[],
  ) {
    const tx = transactionClient(c);
    await tx.execute(
      sql`insert into shipments(id,order_id,reason_code) values(${id},${orderId},${reason})`,
    );
    for (const l of lines)
      await tx.execute(
        sql`insert into shipment_lines(id,shipment_id,allocation_id,quantity) values(${l.id},${id},${l.allocationId},${l.quantity})`,
      );
  }
  /** draft → posted/cancelled; DB guard защищает immutable состав и terminal состояние. */
  async setStatus(c: TransactionContext, id: string, status: 'posted' | 'cancelled') {
    await transactionClient(c).execute(
      sql`update shipments set status=${status},posted_at=${status === 'posted' ? sql`clock_timestamp()` : sql`null`} where id=${id}`,
    );
  }
}
