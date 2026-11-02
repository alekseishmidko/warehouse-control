/** @file Владелец inventory reservations; публичная фасадная точка — InventoryService, context общий с заказом. */
import { Injectable } from '@nestjs/common';
import { ReservationsRepository } from '../repositories/reservations.repository';
import { TransactionContext } from '../../../shared/transactions/transaction.port';
/** Private service не принимает решения о состоянии чужого заказа. */
@Injectable()
export class ReservationsService {
  /** DI только собственного SQL. */ constructor(
    private readonly repository: ReservationsRepository,
  ) {}
  /** Снимок истории обеспечения строки. */ async list(c: TransactionContext, lineId: string) {
    return (await this.repository.list(c, lineId)).map((a) => ({
      id: a.id,
      balanceId: a.balance_id,
      allocated: a.allocated,
      active: a.active,
      released: a.released,
      transferred: a.transferred,
      consumed: a.consumed,
      locationId: a.location_id,
      state:
        a.active > 0
          ? 'active'
          : a.transferred > 0
            ? 'transferred'
            : a.consumed > 0 && a.released > 0
              ? 'closed_mixed'
              : a.consumed > 0
                ? 'consumed'
                : 'released',
      locationKind: a.kind,
    }));
  }
  /** Borrowed reserve; ошибку нельзя подавлять после частичных UPDATE. */ reserve(
    c: TransactionContext,
    warehouseId: string,
    lineId: string,
    productId: string,
    q: number,
  ) {
    return this.repository.reserve(c, warehouseId, lineId, productId, q);
  }
  /** Явный release без TTL и без физического movement. */ release(
    c: TransactionContext,
    lineId: string,
    id: string,
    q: number,
  ) {
    return this.repository.release(c, lineId, id, q);
  }
}
