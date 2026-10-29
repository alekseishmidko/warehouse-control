/** @file Drizzle transaction adapter: scoped capabilities, запрет nested run и отзыв context после callback. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  TransactionContext,
  TransactionRunner,
} from '../../shared/transactions/transaction.port';
import type { createDatabaseConnection } from './connection';

type Database = ReturnType<typeof createDatabaseConnection>['db'];
type DrizzleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type TransactionClient = Omit<DrizzleTransaction, 'transaction' | 'rollback'>;
const clients = new WeakMap<TransactionContext, TransactionClient>();
const scope = new AsyncLocalStorage<TransactionContext>();

/** Только для infrastructure adapters: разрешает действующий context, не создаёт pool/transaction fallback. */
export function transactionClient(context: TransactionContext): TransactionClient {
  const client = clients.get(context);
  if (!client || scope.getStore() !== context) {
    throw new Error('Transaction context is inactive or does not belong to this execution scope');
  }
  return client;
}

/** Владельцем run является сервис сценария, не repository или вызываемый AuditService. */
export class PostgresTransactionRunner implements TransactionRunner {
  /** Получает существующий Drizzle handle; pool lifecycle остаётся у DatabaseService/CLI/test harness. */
  constructor(private readonly db: Database) {}

  /** Запускает read committed transaction ровно один раз; оригинальная ошибка/SQLSTATE передаётся вызывающему. */
  async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    if (scope.getStore())
      throw new Error('Nested transaction run is forbidden; pass the existing context');
    return this.db.transaction(
      async (client) => {
        const context = Object.freeze({}) as TransactionContext;
        clients.set(context, client);
        try {
          return await scope.run(context, () => work(context));
        } finally {
          clients.delete(context);
        }
      },
      { isolationLevel: 'read committed' },
    );
  }
}
