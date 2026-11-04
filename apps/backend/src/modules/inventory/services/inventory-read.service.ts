/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { InventoryReadRepository } from '../repositories/inventory-read.repository';
import { BalanceQueryDto } from '../dto/balances-query.dto';
import { MovementQueryDto } from '../dto/movements-query.dto';
import { PutawaySummaryQueryDto } from '../dto/putaway-tasks-query.dto';
/** Экспортируется только сервис; HTTP adapter проверяет session/warehouse policy до его вызова. */
@Injectable()
export class InventoryReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: InventoryReadRepository) {}
  /** Возвращает bounded balances snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listBalances(context: TransactionContext, warehouseId: string, query: BalanceQueryDto) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.productId !== undefined) {
      q.productId = q.productId.toLowerCase();
      filters.productId = q.productId!;
    }
    if (q.locationId !== undefined) {
      q.locationId = q.locationId.toLowerCase();
      filters.locationId = q.locationId!;
    }
    if (q.locationKind !== undefined) filters.locationKind = q.locationKind;
    const page = preparePageRequest('balances', filters, q.limit, q.cursor);
    return this.repository.listBalances(context, filters.warehouseId, q, page);
  }
  /** Возвращает bounded movements snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listMovements(context: TransactionContext, warehouseId: string, query: MovementQueryDto) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.productId !== undefined) {
      q.productId = q.productId.toLowerCase();
      filters.productId = q.productId!;
    }
    if (q.locationId !== undefined) {
      q.locationId = q.locationId.toLowerCase();
      filters.locationId = q.locationId!;
    }
    if (q.kind !== undefined) {
      q.kind = q.kind;
      filters.kind = q.kind!;
    }
    if (q.auditId !== undefined) {
      q.auditId = q.auditId.toLowerCase();
      filters.auditId = q.auditId!;
    }
    const page = preparePageRequest('movements', filters, q.limit, q.cursor);
    return this.repository.listMovements(context, filters.warehouseId, q, page);
  }
  /** Возвращает bounded putaway-tasks snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listPutawayTasks(
    context: TransactionContext,
    warehouseId: string,
    query: PutawaySummaryQueryDto,
  ) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.productId !== undefined) {
      q.productId = q.productId.toLowerCase();
      filters.productId = q.productId!;
    }
    if (q.status !== undefined) {
      q.status = q.status;
      filters.status = q.status!;
    }
    if (q.sourceReceiptId !== undefined) {
      q.sourceReceiptId = q.sourceReceiptId.toLowerCase();
      filters.sourceReceiptId = q.sourceReceiptId!;
    }
    const page = preparePageRequest('putaway-tasks', filters, q.limit, q.cursor);
    return this.repository.listPutawayTasks(context, filters.warehouseId, q, page);
  }
}
