/** @file Чтение принадлежащих модулю данных: точные параметризованные фильтры и явные JSON проекции. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { PageRequest } from '../../../shared/pagination/keyset-page';
import { readKeysetPage } from '../../../infrastructure/database/read-keyset-page';
import { BalanceQueryDto } from '../dto/balances-query.dto';
import { BalanceDto } from '../dto/balances-read.dto';
import { MovementQueryDto } from '../dto/movements-query.dto';
import { MovementDto } from '../dto/movements-read.dto';
import { PutawaySummaryQueryDto } from '../dto/putaway-tasks-query.dto';
import { PutawaySummaryDto } from '../dto/putaway-tasks-read.dto';
/** Внутренний provider: не открывает run, не пишет данные и не принимает произвольные SQL имена. */
@Injectable()
export class InventoryReadRepository {
  /** Читает balances после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listBalances(
    context: TransactionContext,
    warehouseId: string,
    q: BalanceQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<BalanceDto>(context, page, {
      from: sql`stock_balances b join locations l on l.id=b.location_id and l.warehouse_id=b.warehouse_id`,
      id: sql`b.id`,
      projection: sql`b.id as "id",b.warehouse_id as "warehouseId",b.product_id as "productId",b.location_id as "locationId",l.kind as "locationKind",b.on_hand as "onHand",b.reserved as "reserved",b.on_hand-b.reserved as "available"`,
      where: sql.join(
        [
          sql`b.warehouse_id=${warehouseId}::uuid`,
          q.locationKind ? sql`l.kind=${q.locationKind}` : sql`true`,
          q.productId ? sql`b.product_id=${q.productId}::uuid` : sql`true`,
          q.locationId ? sql`b.location_id=${q.locationId}::uuid` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
  /** Читает movements после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listMovements(
    context: TransactionContext,
    warehouseId: string,
    q: MovementQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<MovementDto>(context, page, {
      from: sql`stock_movements m`,
      id: sql`m.id`,
      time: sql`m.created_at`,
      projection: sql`m.id as "id",m.warehouse_id as "warehouseId",m.product_id as "productId",m.location_id as "locationId",m.kind as "kind",m.quantity as "quantity",m.audit_id as "auditId",m.operation_id as "operationId",m.transfer_id as "transferId",m.picking_transfer_id as "pickingTransferId",m.shipping_effect_id as "shippingEffectId",to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`,
      where: sql.join(
        [
          sql`m.warehouse_id=${warehouseId}::uuid`,
          q.productId ? sql`m.product_id=${q.productId}::uuid` : sql`true`,
          q.locationId ? sql`m.location_id=${q.locationId}::uuid` : sql`true`,
          q.kind ? sql`m.kind=${q.kind}` : sql`true`,
          q.auditId ? sql`m.audit_id=${q.auditId}::uuid` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
  /** Читает putaway-tasks после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listPutawayTasks(
    context: TransactionContext,
    warehouseId: string,
    q: PutawaySummaryQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<PutawaySummaryDto>(context, page, {
      from: sql`putaway_tasks t`,
      id: sql`t.id`,
      time: sql`t.created_at`,
      projection: sql`t.id as "id",t.warehouse_id as "warehouseId",t.product_id as "productId",t.source_receipt_id as "sourceReceiptId",t.source_event_id as "sourceEventId",t.status as "status",t.quantity as "quantity",to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`,
      where: sql.join(
        [
          sql`t.warehouse_id=${warehouseId}::uuid`,
          q.productId ? sql`t.product_id=${q.productId}::uuid` : sql`true`,
          q.status ? sql`t.status=${q.status}` : sql`true`,
          q.sourceReceiptId ? sql`t.source_receipt_id=${q.sourceReceiptId}::uuid` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
}
