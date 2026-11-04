/** @file Чтение принадлежащих модулю данных: точные параметризованные фильтры и явные JSON проекции. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { PageRequest } from '../../../shared/pagination/keyset-page';
import { readKeysetPage } from '../../../infrastructure/database/read-keyset-page';
import { AuditSummaryQueryDto } from '../dto/audit-query.dto';
import { AuditSummaryDto } from '../dto/audit-read.dto';
/** Внутренний provider: не открывает run, не пишет данные и не принимает произвольные SQL имена. */
@Injectable()
export class AuditReadRepository {
  /** Читает audit после складской policy. Audit scope выводится из retained объектов, не из JSON changes. */
  listAuditEntries(
    context: TransactionContext,
    warehouseId: string,
    q: AuditSummaryQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<AuditSummaryDto>(context, page, {
      from: sql`audit_entries a`,
      id: sql`a.id`,
      time: sql`a.occurred_at`,
      projection: sql`a.id as "id",a.actor_type as "actorType",a.actor_id as "actorId",a.action as "action",a.entity_type as "entityType",a.entity_id as "entityId",a.correlation_id as "correlationId",a.reason_code as "reasonCode",a.has_redacted_changes as "hasRedactedChanges",to_char(a.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "occurredAt"`,
      where: sql.join(
        [
          sql`((a.entity_type='warehouse' and a.entity_id=${warehouseId}::uuid)
 or (a.entity_type='location' and exists(select 1 from locations l where l.id=a.entity_id and l.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='stock-balance' and exists(select 1 from stock_balances b where b.id=a.entity_id and b.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='receipt' and exists(select 1 from receipts r where r.id=a.entity_id and r.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='putaway-task' and exists(select 1 from putaway_tasks t where t.id=a.entity_id and t.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='order' and exists(select 1 from orders o where o.id=a.entity_id and o.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='picking-task' and exists(select 1 from picking_tasks t join orders o on o.id=t.order_id where t.id=a.entity_id and o.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='shipment' and exists(select 1 from shipments s join orders o on o.id=s.order_id where s.id=a.entity_id and o.warehouse_id=${warehouseId}::uuid))
 or (a.entity_type='allocation' and exists(select 1 from stock_allocations x join stock_balances b on b.id=x.balance_id where x.id=a.entity_id and b.warehouse_id=${warehouseId}::uuid)))`,
          q.entityType ? sql`a.entity_type=${q.entityType}` : sql`true`,
          q.entityId ? sql`a.entity_id=${q.entityId}::uuid` : sql`true`,
          q.correlationId ? sql`a.correlation_id=${q.correlationId}::uuid` : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
}
