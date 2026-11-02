/** @file SQL заданий сборки. Заказ блокирует сервис до task; каждый вызов заимствует context без commit. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
/** Внутренний provider fulfillment; не изменяет складские таблицы. */
@Injectable()
export class PickingRepository {
  /** Читает метаданные до policy либо блокирует задание после order lock. */
  async findTask(c: TransactionContext, id: string, lock = false) {
    return (
      await transactionClient(c).execute<{
        id: string;
        order_id: string;
        status: string;
        assignee_id: string | null;
      }>(sql`select * from picking_tasks where id=${id} ${lock ? sql`for update` : sql``}`)
    ).rows[0];
  }
  /** Возвращает план и подтверждённые количества; строки изменяются только под parent lock. */
  async listLines(c: TransactionContext, id: string) {
    return (
      await transactionClient(c).execute<{
        id: string;
        allocation_id: string;
        planned: number;
        picked_total: number;
        cancelled_unpicked: number;
      }>(sql`select * from picking_lines where task_id=${id} order by id`)
    ).rows;
  }
  /** Создаёт immutable план, не создавая stock или allocations. UNIQUE защищает второй открытый план. */
  async createTask(
    c: TransactionContext,
    id: string,
    orderId: string,
    lines: { id: string; allocationId: string; quantity: number }[],
  ) {
    const tx = transactionClient(c);
    await tx.execute(sql`insert into picking_tasks(id,order_id) values(${id},${orderId})`);
    for (const l of lines)
      await tx.execute(
        sql`insert into picking_lines(id,task_id,allocation_id,planned) values(${l.id},${id},${l.allocationId},${l.quantity})`,
      );
  }
  /** Сохраняет только lifecycle поля; сохранённый исполнитель не заменяется при повторном start. */
  async setTaskState(c: TransactionContext, id: string, status: string, assignee: string | null) {
    await transactionClient(c).execute(
      sql`update picking_tasks set status=${status},assignee_id=${assignee} where id=${id}`,
    );
  }
  /** Увеличивает исторически собранное; CHECK запрещает превышение planned. */
  async addPickedQuantity(c: TransactionContext, lineId: string, quantity: number) {
    await transactionClient(c).execute(
      sql`update picking_lines set picked_total=picked_total+${quantity} where id=${lineId}`,
    );
  }
  /** Наличие незакрытого плана запрещает независимый release его обеспечения. */
  async hasOpenTask(c: TransactionContext, orderId: string) {
    return (
      (
        await transactionClient(c).execute(
          sql`select id from picking_tasks where order_id=${orderId} and status in ('ready','in_progress','shortage')`,
        )
      ).rows.length > 0
    );
  }
  /** Отменяет только несобранные планы под order lock; товар выпускает inventory в том же context. */
  async cancelUnpickedTasks(c: TransactionContext, orderId: string) {
    const tx = transactionClient(c);
    await tx.execute(
      sql`update picking_lines set cancelled_unpicked=planned-picked_total where task_id in (select id from picking_tasks where order_id=${orderId} and status in ('ready','in_progress','shortage'))`,
    );
    return (
      await tx.execute<{ id: string }>(
        sql`update picking_tasks set status='cancelled' where order_id=${orderId} and status in ('ready','in_progress','shortage') returning id`,
      )
    ).rows;
  }
}
