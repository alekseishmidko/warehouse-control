/** @file SQL только inventory.putaway_tasks: lookup/INSERT и однократное завершение; stock/receiving/outbox принадлежат другим providers. */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { putawayTasks } from '../putaway-task.schema';
import type { PutawayTaskDto } from '../dto/putaway-task.dto';
/** Private provider. Отсутствующая строка не блокируется lookup; unique constraint — последняя защита concurrent INSERT. */
@Injectable()
export class PutawayRepository {
  /** Возвращает task с неизменным source либо null в текущем context; читает только таблицу inventory. */
  async findBySourceLine(
    context: TransactionContext,
    lineId: string,
  ): Promise<PutawayTaskDto | null> {
    const [row] = await transactionClient(context)
      .select()
      .from(putawayTasks)
      .where(eq(putawayTasks.sourceReceiptLineId, lineId));
    return row ? this.snapshot(row) : null;
  }
  /**
   * Вставляет task с обязательным auditId; FK/unique ошибки выходят до runner.
   * Unique race не подавляется: иначе уже записанный audit проигравшего мог бы остаться orphan.
   */
  async insert(
    context: TransactionContext,
    task: Omit<
      PutawayTaskDto,
      'createdAt' | 'targetLocationId' | 'completedAt' | 'completedEventId' | 'completionAuditId'
    >,
  ): Promise<PutawayTaskDto> {
    const [row] = await transactionClient(context).insert(putawayTasks).values(task).returning();
    return this.snapshot(row);
  }
  /** Читает task в caller context; FOR UPDATE сериализует повторные исполнения до проверки pending. */
  async findById(
    context: TransactionContext,
    id: string,
    lock = false,
  ): Promise<PutawayTaskDto | null> {
    const query = transactionClient(context)
      .select()
      .from(putawayTasks)
      .where(eq(putawayTasks.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row ? this.snapshot(row) : null;
  }
  /** Финализирует task после movements/outbox; trigger разрешает только pending → completed и сохраняет основание. */
  async complete(
    context: TransactionContext,
    id: string,
    targetLocationId: string,
    completedAt: string,
    completedEventId: string,
    completionAuditId: string,
  ): Promise<PutawayTaskDto> {
    const [row] = await transactionClient(context)
      .update(putawayTasks)
      .set({
        status: 'completed',
        targetLocationId,
        completedAt: new Date(completedAt),
        completedEventId,
        completionAuditId,
      })
      .where(eq(putawayTasks.id, id))
      .returning();
    return this.snapshot(row);
  }
  /** Единая module-local проекция Date → UTC ISO для всех reads/writes; SQL NULL completion остаётся null. */
  private snapshot(row: typeof putawayTasks.$inferSelect): PutawayTaskDto {
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
