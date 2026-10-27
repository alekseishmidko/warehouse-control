/** @file SQL только inventory.putaway_tasks: lookup для повторов и INSERT, никаких writes в stock/receiving/outbox. */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { putawayTasks } from '../putaway-task.schema';
import type { PutawayTaskDto } from '../dto/putaway-task.dto';
/** Private provider. Отсутствующая строка не блокируется lookup; unique constraint — последняя защита concurrent INSERT. */
@Injectable()
export class PutawayRepository {
  /** Возвращает immutable task либо null в текущем context; читает только таблицу inventory. */
  async findBySourceLine(context: TransactionContext, lineId: string): Promise<PutawayTaskDto | null> {
    const [row] = await transactionClient(context).select().from(putawayTasks).where(eq(putawayTasks.sourceReceiptLineId, lineId));
    return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
  }
  /**
   * Вставляет task с обязательным auditId; FK/unique ошибки выходят до runner.
   * Unique race не подавляется: иначе уже записанный audit проигравшего мог бы остаться orphan.
   */
  async insert(context: TransactionContext, task: Omit<PutawayTaskDto, 'createdAt'>): Promise<PutawayTaskDto> {
    const [row] = await transactionClient(context).insert(putawayTasks).values(task).returning();
    return { ...row, createdAt: row.createdAt.toISOString() };
  }
}
