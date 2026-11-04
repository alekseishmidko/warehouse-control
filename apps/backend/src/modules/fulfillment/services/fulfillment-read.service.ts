/** @file Сервис чтения модуля: нормализация фильтров и borrowed context без дополнительной транзакции. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { preparePageRequest } from '../../../shared/pagination/keyset-page';
import { FulfillmentReadRepository } from '../repositories/fulfillment-read.repository';
import { OrderSummaryQueryDto } from '../dto/orders-query.dto';
import { PickingSummaryQueryDto } from '../dto/picking-tasks-query.dto';
import { ShipmentSummaryQueryDto } from '../dto/shipments-query.dto';
/** Экспортируется только сервис; HTTP adapter проверяет session/warehouse policy до его вызова. */
@Injectable()
export class FulfillmentReadService {
  /** Repository остаётся private provider владельца данных. */
  constructor(private readonly repository: FulfillmentReadRepository) {}
  /** Возвращает bounded orders snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listOrders(context: TransactionContext, warehouseId: string, query: OrderSummaryQueryDto) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.status !== undefined) {
      q.status = q.status;
      filters.status = q.status!;
    }
    const page = preparePageRequest('orders', filters, q.limit, q.cursor);
    return this.repository.listOrders(context, filters.warehouseId, q, page);
  }
  /** Возвращает bounded picking-tasks snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listPickingTasks(
    context: TransactionContext,
    warehouseId: string,
    query: PickingSummaryQueryDto,
  ) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.status !== undefined) {
      q.status = q.status;
      filters.status = q.status!;
    }
    if (q.orderId !== undefined) {
      q.orderId = q.orderId.toLowerCase();
      filters.orderId = q.orderId!;
    }
    if (q.assigneeId !== undefined) {
      q.assigneeId = q.assigneeId.toLowerCase();
      filters.assigneeId = q.assigneeId!;
    }
    const page = preparePageRequest('picking-tasks', filters, q.limit, q.cursor);
    return this.repository.listPickingTasks(context, filters.warehouseId, q, page);
  }
  /** Возвращает bounded shipments snapshot; вход валидирован HTTP DTO, склад проверен caller в том же context.
   * @throws VALIDATION_FAILED для malformed/cross-filter cursor; SQL ошибка откатывает read run.
   */
  listShipments(context: TransactionContext, warehouseId: string, query: ShipmentSummaryQueryDto) {
    const q = { ...query };
    const filters: Record<string, string> = { warehouseId: warehouseId.toLowerCase() };
    if (q.status !== undefined) {
      q.status = q.status;
      filters.status = q.status!;
    }
    if (q.orderId !== undefined) {
      q.orderId = q.orderId.toLowerCase();
      filters.orderId = q.orderId!;
    }
    const page = preparePageRequest('shipments', filters, q.limit, q.cursor);
    return this.repository.listShipments(context, filters.warehouseId, q, page);
  }
}
