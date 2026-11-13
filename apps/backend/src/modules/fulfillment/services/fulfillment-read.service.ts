/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { FulfillmentReadRepository } from '../repositories/fulfillment-read.repository';
import { OrderSummaryQueryDto } from '../dto/orders-query.dto';
import { PickingSummaryQueryDto } from '../dto/picking-tasks-query.dto';
import { ShipmentSummaryQueryDto } from '../dto/shipments-query.dto';
/** HTTP adapter проверяет session/warehouse policy в том же transaction context.
 * Методы нормализуют копию DTO, затем явно перечисляют фильтры cursor scope.
 * SQL получает те же UUID; limit/cursor не входят в scope. Отсутствующие фильтры
 * обрабатывает общий preparePageRequest, а whitelist остаётся у владельца списка.
 */
@Injectable()
export class FulfillmentReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: FulfillmentReadRepository) {}
  /** Возвращает bounded orders snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listOrders(context: TransactionContext, warehouseId: string, query: OrderSummaryQueryDto) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const page = preparePageRequest(
      'orders',
      { warehouseId: normalizedWarehouseId, status: query.status },
      query.limit,
      query.cursor,
    );
    return this.repository.listOrders(context, normalizedWarehouseId, query, page);
  }
  /** Возвращает bounded picking-tasks snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listPickingTasks(
    context: TransactionContext,
    warehouseId: string,
    query: PickingSummaryQueryDto,
  ) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      orderId: query.orderId?.toLowerCase(),
      assigneeId: query.assigneeId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'picking-tasks',
      {
        warehouseId: normalizedWarehouseId,
        status: normalizedQuery.status,
        orderId: normalizedQuery.orderId,
        assigneeId: normalizedQuery.assigneeId,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listPickingTasks(context, normalizedWarehouseId, normalizedQuery, page);
  }
  /** Возвращает bounded shipments snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listShipments(context: TransactionContext, warehouseId: string, query: ShipmentSummaryQueryDto) {
    const normalizedWarehouseId = warehouseId.toLowerCase();
    const normalizedQuery = {
      ...query,
      orderId: query.orderId?.toLowerCase(),
    };
    const page = preparePageRequest(
      'shipments',
      {
        warehouseId: normalizedWarehouseId,
        status: normalizedQuery.status,
        orderId: normalizedQuery.orderId,
      },
      normalizedQuery.limit,
      normalizedQuery.cursor,
    );
    return this.repository.listShipments(context, normalizedWarehouseId, normalizedQuery, page);
  }
}
