/** @file Авторизация: текущая session/global admin и принятая матрица действий в конкретном warehouse. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { CommandError } from '../../../shared/errors/command-error';
import { IdentityRepository } from '../repositories/identity.repository';
import { IdentityTransactionsService } from './identity-transactions.service';
import { isUuid } from '../../../shared/validation/identifiers';
import { Principal } from '../dto/principal.dto';
import { WarehouseRole, WarehouseAction } from '../dto/warehouse-role.types';
import { SessionsService } from './sessions.service';
/** Фиксированная матрица ADR-0019: новые действия запрещены, пока явно не перечислены. */
const ACTIONS: Record<WarehouseRole, readonly WarehouseAction[]> = {
  viewer: ['read'],
  warehouse_operator: ['read', 'receive', 'putaway', 'pick', 'ship', 'return'],
  order_manager: ['read', 'order', 'reserve', 'cancel', 'audit'],
  warehouse_supervisor: [
    'read',
    'receive',
    'putaway',
    'pick',
    'ship',
    'return',
    'order',
    'reserve',
    'cancel',
    'adjust',
    'audit',
  ],
};
/** Policy не выдаёт system_admin складские права и не меняет grants; изменения принадлежат UsersService. */
@Injectable()
export class AccessService {
  /** Сессия проверяется владельцем, затем repository читает grants под тем же user lock. */
  constructor(
    private readonly transactions: IdentityTransactionsService,
    private readonly repository: IdentityRepository,
    private readonly sessions: SessionsService,
  ) {}
  /**
   * Владеет короткой read/guard транзакцией, когда у вызывающего ещё нет context.
   * Для HTTP command нужно передать его context в requireWarehouse/requireAdmin, не вызывать run.
   * @throws Callback/DB ошибка откатывает транзакцию; nested run запрещён runner.
   */
  async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.transactions.run(work);
  }
  /** Проверяет роль именно на складе объекта; system_admin не является складским суперпользователем. */
  async requireWarehouse(
    context: TransactionContext,
    principal: Principal,
    warehouseId: string,
    action: WarehouseAction,
  ): Promise<void> {
    await this.sessions.requireSession(context, principal);
    if (!isUuid(warehouseId)) throw new CommandError('VALIDATION_FAILED');
    const roles = await this.repository.roles(context, principal.userId);
    if (
      !roles.some(
        (row) =>
          row.warehouse_id === warehouseId.toLowerCase() &&
          ACTIONS[row.role as WarehouseRole]?.includes(action),
      )
    )
      throw new CommandError('FORBIDDEN');
  }
  /** Серверная проверка global admin выполняется заново и для каждой административной мутации. */
  async requireAdmin(context: TransactionContext, principal: Principal): Promise<void> {
    if (!(await this.sessions.requireSession(context, principal)).systemAdmin)
      throw new CommandError('FORBIDDEN');
  }
}
