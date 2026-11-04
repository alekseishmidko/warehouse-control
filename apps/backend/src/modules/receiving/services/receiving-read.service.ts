/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { ReceivingReadRepository } from '../repositories/receiving-read.repository';
import { ReceiptSummaryQueryDto } from '../dto/receipts-query.dto';
/** Экспортируется только сервис; HTTP adapter проверяет session/warehouse policy до его вызова. */
@Injectable()
export class ReceivingReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: ReceivingReadRepository) {}
  /** Возвращает bounded receipts snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listReceipts(context: TransactionContext, warehouseId: string, query: ReceiptSummaryQueryDto) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.status !== undefined) {
      q.status = q.status;
      filters.status = q.status!;
    }
    if (q.receivingLocationId !== undefined) {
      q.receivingLocationId = q.receivingLocationId.toLowerCase();
      filters.receivingLocationId = q.receivingLocationId!;
    }
    const page = preparePageRequest('receipts', filters, q.limit, q.cursor);
    return this.repository.listReceipts(context, filters.warehouseId, q, page);
  }
}
