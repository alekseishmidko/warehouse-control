/** @file Внутренний владелец bounded identity transactions; одинаковая настройка timeout для всех сценариев модуля. */
import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  TransactionContext,
  TransactionRunner,
} from '../../../shared/transactions/transaction.port';
import { IdentityRepository } from '../repositories/identity.repository';
/** Не экспортируется из Nest-модуля; вызовы с borrowed context не открывают здесь второй run. */
@Injectable()
export class IdentityTransactionsService {
  /** Runner управляет commit/rollback, repository устанавливает прежние DB timeouts. */
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
    private readonly repository: IdentityRepository,
  ) {}
  /** Один bounded run. Callback не должен выполнять внешнее I/O или nested run. */
  async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.transactions.run(async (context) => {
      await this.repository.bound(context);
      return work(context);
    });
  }
}
