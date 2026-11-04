/** @file Чтение принадлежащих модулю данных: точные параметризованные фильтры и явные JSON проекции. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { PageRequest } from '../../../shared/pagination/keyset-page';
import { readKeysetPage } from '../../../infrastructure/database/read-keyset-page';
import { ReceiptSummaryQueryDto } from '../dto/receipts-query.dto';
import { ReceiptSummaryDto } from '../dto/receipts-read.dto';
/** Внутренний provider: не открывает run, не пишет данные и не принимает произвольные SQL имена. */
@Injectable()
export class ReceivingReadRepository {
  /** Читает receipts после складской policy. Все фильтры добавляются как параметры, граница страницы — неизменный ключ. */
  listReceipts(
    context: TransactionContext,
    warehouseId: string,
    q: ReceiptSummaryQueryDto,
    page: PageRequest,
  ) {
    return readKeysetPage<ReceiptSummaryDto>(context, page, {
      from: sql`receipts r`,
      id: sql`r.id`,
      time: sql`r.created_at`,
      projection: sql`r.id as "id",r.warehouse_id as "warehouseId",r.receiving_location_id as "receivingLocationId",r.status as "status",r.posted_event_id as "postedEventId",to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"`,
      where: sql.join(
        [
          sql`r.warehouse_id=${warehouseId}::uuid`,
          q.status ? sql`r.status=${q.status}` : sql`true`,
          q.receivingLocationId
            ? sql`r.receiving_location_id=${q.receivingLocationId}::uuid`
            : sql`true`,
        ],
        sql` and `,
      ),
    });
  }
}
