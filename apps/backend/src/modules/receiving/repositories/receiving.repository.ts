/** @file SQL только receiving: parent lock сериализует posting, транзакцией владеет вызывающий сервис. */
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { receipts, receiptLines } from '../receiving.schema';
import type { ReceiptDto, ReceiptLineDto } from '../dto/receipt.dto';

/** Приватный provider модуля: не использует pool, runner или repositories соседей. */
@Injectable()
export class ReceivingRepository {
  /** Вставляет серверные IDs и строки; ошибка FK/unique отменяет весь draft вместе с HTTP claim. */
  async create(
    context: TransactionContext,
    document: Pick<ReceiptDto, 'id' | 'warehouseId' | 'receivingLocationId'>,
    lines: ReceiptLineDto[],
  ): Promise<ReceiptDto> {
    await transactionClient(context).insert(receipts).values(document);
    await transactionClient(context)
      .insert(receiptLines)
      .values(lines.map((line) => ({ ...line, receiptId: document.id })));
    return (await this.find(context, document.id))!;
  }
  /**
   * Читает документ; lock=true только в posting до чтения состояния/строк.
   * @returns JSON snapshot либо null. Блокировка сохраняется до commit/rollback общего runner.
   * При read committed конкурентный posting после ожидания видит уже posted строку.
   */
  async find(context: TransactionContext, id: string, lock = false): Promise<ReceiptDto | null> {
    const query = transactionClient(context).select().from(receipts).where(eq(receipts.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) return null;
    const lines = await transactionClient(context)
      .select({
        id: receiptLines.id,
        position: receiptLines.position,
        productId: receiptLines.productId,
        quantity: receiptLines.quantity,
      })
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(asc(receiptLines.position));
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      postedAt: row.postedAt?.toISOString() ?? null,
      lines,
    };
  }
  /** Фиксирует единственный переход после stock/audit/outbox; guard БД запрещает последующие изменения. */
  async markPosted(
    context: TransactionContext,
    id: string,
    postedAt: string,
    postedEventId: string,
  ): Promise<void> {
    await transactionClient(context)
      .update(receipts)
      .set({ status: 'posted', postedAt: new Date(postedAt), postedEventId })
      .where(eq(receipts.id, id));
  }
}
