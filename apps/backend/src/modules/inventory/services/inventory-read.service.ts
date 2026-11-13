/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { InventoryReadRepository } from '../repositories/inventory-read.repository';
import { BalanceQueryDto } from '../dto/balances-query.dto';
import { MovementQueryDto } from '../dto/movements-query.dto';
import { PutawaySummaryQueryDto } from '../dto/putaway-tasks-query.dto';
/** HTTP adapter проверяет session/warehouse policy в том же transaction context.
 * Методы нормализуют копию DTO, затем явно перечисляют фильтры cursor scope.
 * SQL получает те же UUID; limit/cursor не входят в scope. Отсутствующие фильтры
 * обрабатывает общий preparePageRequest, а whitelist остаётся у владельца списка.
 */
@Injectable()
export class InventoryReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: InventoryReadRepository) {}
  /** Возвращает bounded balances snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listBalances(context: TransactionContext, warehouseId: string, query: BalanceQueryDto) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      productId: query.productId?.toLowerCase(),
      locationId: query.locationId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'balances',
      {
        warehouseId: normalizedWarehouseId,
        productId: normalizedQuery.productId,
        locationId: normalizedQuery.locationId,
        locationKind: normalizedQuery.locationKind,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listBalances(context, normalizedWarehouseId, normalizedQuery, page);
  }
  /** Возвращает bounded movements snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listMovements(context: TransactionContext, warehouseId: string, query: MovementQueryDto) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      productId: query.productId?.toLowerCase(),
      locationId: query.locationId?.toLowerCase(),
      auditId: query.auditId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'movements',
      {
        warehouseId: normalizedWarehouseId,
        productId: normalizedQuery.productId,
        locationId: normalizedQuery.locationId,
        kind: normalizedQuery.kind,
        auditId: normalizedQuery.auditId,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listMovements(context, normalizedWarehouseId, normalizedQuery, page);
  }
  /** Возвращает bounded putaway-tasks snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listPutawayTasks(
    context: TransactionContext,
    warehouseId: string,
    query: PutawaySummaryQueryDto,
  ) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      productId: query.productId?.toLowerCase(),
      sourceReceiptId: query.sourceReceiptId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'putaway-tasks',
      {
        warehouseId: normalizedWarehouseId,
        productId: normalizedQuery.productId,
        status: normalizedQuery.status,
        sourceReceiptId: normalizedQuery.sourceReceiptId,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listPutawayTasks(context, normalizedWarehouseId, normalizedQuery, page);
  }
}
