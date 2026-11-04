/** @file Чтение принадлежащих модулю данных: точные параметризованные фильтры и явные JSON проекции. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { PageRequest } from '../../../shared/pagination/keyset-page';
import { readKeysetPage } from '../../../infrastructure/database/read-keyset-page';
import { OrderSummaryQueryDto } from '../dto/orders-query.dto';
import { OrderSummaryDto } from '../dto/orders-read.dto';
import { PickingSummaryQueryDto } from '../dto/picking-tasks-query.dto';
import { PickingSummaryDto } from '../dto/picking-tasks-read.dto';
import { ShipmentSummaryQueryDto } from '../dto/shipments-query.dto';
import { ShipmentSummaryDto } from '../dto/shipments-read.dto';
/** Внутренний provider: не открывает run, не пишет данные и не принимает произвольные SQL имена. */
@Injectable()
export class FulfillmentReadRepository {
  /** Читает orders после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listOrders(
    context: TransactionContext,
    warehouseId: string,
    q: OrderSummaryQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<OrderSummaryDto>(context, page, {
      from: sql`orders o`,
      id: sql`o.id`,
      projection: sql`o.id as "id",o.warehouse_id as "warehouseId",o.status as "status"`,
      where: sql.join(
        [
          sql`o.warehouse_id=${warehouseId}::uuid`,
          q.status ? sql`o.status=${q.status}` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
  /** Читает picking-tasks после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listPickingTasks(
    context: TransactionContext,
    warehouseId: string,
    q: PickingSummaryQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<PickingSummaryDto>(context, page, {
      from: sql`picking_tasks t join orders o on o.id=t.order_id`,
      id: sql`t.id`,
      time: sql`t.created_at`,
      projection: sql`t.id as "id",o.warehouse_id as "warehouseId",t.order_id as "orderId",t.status as "status",t.assignee_id as "assigneeId",to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`,
      where: sql.join(
        [
          sql`o.warehouse_id=${warehouseId}::uuid`,
          q.status ? sql`t.status=${q.status}` : sql`true`,
          q.orderId ? sql`t.order_id=${q.orderId}::uuid` : sql`true`,
          q.assigneeId ? sql`t.assignee_id=${q.assigneeId}::uuid` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
  /** Читает shipments после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listShipments(
    context: TransactionContext,
    warehouseId: string,
    q: ShipmentSummaryQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<ShipmentSummaryDto>(context, page, {
      from: sql`shipments s join orders o on o.id=s.order_id`,
      id: sql`s.id`,
      time: sql`s.created_at`,
      projection: sql`s.id as "id",o.warehouse_id as "warehouseId",s.order_id as "orderId",s.status as "status",s.reason_code as "reasonCode",to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`,
      where: sql.join(
        [
          sql`o.warehouse_id=${warehouseId}::uuid`,
          q.status ? sql`s.status=${q.status}` : sql`true`,
          q.orderId ? sql`s.order_id=${q.orderId}::uuid` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
}
