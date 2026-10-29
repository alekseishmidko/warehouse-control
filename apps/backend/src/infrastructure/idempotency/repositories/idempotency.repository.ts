/** @file Private PostgreSQL claim/result adapter; INSERT unique ждёт concurrent transaction, read идёт отдельным statement. */
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandResult, CommandScope } from '../../../shared/operations/dto/command-scope.dto';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { transactionClient } from '../../database/postgres-transaction-runner';
import { httpIdempotency as table } from '../idempotency.schema';
/** Scope condition остаётся локальным SQL helper, не generic repository. */
const scopeWhere = (scope: CommandScope) =>
  and(
    eq(table.actorType, scope.actorType),
    eq(table.actorId, scope.actorId),
    eq(table.operation, scope.operation),
    eq(table.key, scope.key),
  );
/** Использует только borrowed context, не открывает дополнительный pool/transaction. */
@Injectable()
export class IdempotencyRepository {
  /**
   * Вставляет pending identity/hash без response в обязательный caller-owned context.
   * @returns true при новом claim; false если unique scope уже зафиксирован конкурентом.
   * Ожидание unique lock длится до commit/rollback владельца. SQL ошибки не подавляются.
   */
  async claim(
    context: TransactionContext,
    scope: CommandScope,
    requestHash: string,
  ): Promise<boolean> {
    const rows = await transactionClient(context)
      .insert(table)
      .values({
        actorType: scope.actorType,
        actorId: scope.actorId,
        operation: scope.operation,
        key: scope.key,
        requestHash,
      })
      .onConflictDoNothing()
      .returning({ key: table.key });
    return rows.length === 1;
  }
  /**
   * Читает scope отдельным read committed statement после claim=false.
   * @returns Сохранённая строка либо undefined при нарушении ожидаемого storage state.
   * Не берёт новую транзакцию: immutable completed result не нуждается в отдельном UPDATE lock.
   */
  async find(context: TransactionContext, scope: CommandScope) {
    const [row] = await transactionClient(context).select().from(table).where(scopeWhere(scope));
    return row;
  }
  /**
   * Сохраняет проверенный сервисом success snapshot в pending строку текущего владельца.
   * @param result Уже скопированный JSON result; repository не выполняет бизнес-нормализацию.
   * JSONB null body сохраняется явно: SQL NULL обозначает ещё не заполненный pending.
   * now() — transaction timestamp, не время получения HTTP-ответа. Commit остаётся у runner.
   * Попытку изменить completed snapshot отклонит immutable trigger; ошибка приводит к rollback.
   */
  async complete(
    context: TransactionContext,
    scope: CommandScope,
    result: CommandResult,
  ): Promise<void> {
    await transactionClient(context)
      .update(table)
      .set({
        statusCode: result.statusCode,
        body: sql`${JSON.stringify(result.body)}::jsonb`,
        headers: result.headers ?? {},
        completedAt: sql`now()`,
      })
      .where(scopeWhere(scope));
  }
}
