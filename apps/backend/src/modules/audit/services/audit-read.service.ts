/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { AuditReadRepository } from '../repositories/audit-read.repository';
import { AuditSummaryQueryDto } from '../dto/audit-query.dto';
/** Экспортируется только сервис; HTTP adapter проверяет session/warehouse policy до его вызова. */
@Injectable()
export class AuditReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: AuditReadRepository) {}
  /** Возвращает bounded audit snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listAuditEntries(context: TransactionContext, warehouseId: string, query: AuditSummaryQueryDto) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.entityType !== undefined) {
      q.entityType = q.entityType;
      filters.entityType = q.entityType!;
    }
    if (q.entityId !== undefined) {
      q.entityId = q.entityId.toLowerCase();
      filters.entityId = q.entityId!;
    }
    if (q.correlationId !== undefined) {
      q.correlationId = q.correlationId.toLowerCase();
      filters.correlationId = q.correlationId!;
    }
    const page = preparePageRequest('audit', filters, q.limit, q.cursor);
    return this.repository.listAuditEntries(context, filters.warehouseId, q, page);
  }
}
