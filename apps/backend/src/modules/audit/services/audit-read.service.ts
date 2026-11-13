/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { AuditReadRepository } from '../repositories/audit-read.repository';
import { AuditSummaryQueryDto } from '../dto/audit-query.dto';
/** HTTP adapter проверяет session/warehouse policy в том же transaction context.
 * Методы нормализуют копию DTO, затем явно перечисляют фильтры cursor scope.
 * SQL получает те же UUID; limit/cursor не входят в scope. Отсутствующие фильтры
 * обрабатывает общий preparePageRequest, а whitelist остаётся у владельца списка.
 */
@Injectable()
export class AuditReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: AuditReadRepository) {}
  /** Возвращает bounded audit snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listAuditEntries(context: TransactionContext, warehouseId: string, query: AuditSummaryQueryDto) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      entityId: query.entityId?.toLowerCase(),
      correlationId: query.correlationId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'audit',
      {
        warehouseId: normalizedWarehouseId,
        entityType: normalizedQuery.entityType,
        entityId: normalizedQuery.entityId,
        correlationId: normalizedQuery.correlationId,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listAuditEntries(context, normalizedWarehouseId, normalizedQuery, page);
  }
}
