/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { ReceivingReadRepository } from '../repositories/receiving-read.repository';
import { ReceiptSummaryQueryDto } from '../dto/receipts-query.dto';
/** HTTP adapter проверяет session/warehouse policy в том же transaction context.
 * Методы нормализуют копию DTO, затем явно перечисляют фильтры cursor scope.
 * SQL получает те же UUID; limit/cursor не входят в scope. Отсутствующие фильтры
 * обрабатывает общий preparePageRequest, а whitelist остаётся у владельца списка.
 */
@Injectable()
export class ReceivingReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: ReceivingReadRepository) {}
  /** Возвращает bounded receipts snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listReceipts(context: TransactionContext, warehouseId: string, query: ReceiptSummaryQueryDto) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      receivingLocationId: query.receivingLocationId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'receipts',
      {
        warehouseId: normalizedWarehouseId,
        status: normalizedQuery.status,
        receivingLocationId: normalizedQuery.receivingLocationId,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listReceipts(context, normalizedWarehouseId, normalizedQuery, page);
  }
}
