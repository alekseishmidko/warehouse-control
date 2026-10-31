/** @file Пользователи и административные сценарии identity: профиль, credentials, warehouse grants и первый admin с атомарным audit. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { CommandError } from '../../../shared/errors/command-error';
import { IdentityRepository } from '../repositories/identity.repository';
import { IdentityTransactionsService } from './identity-transactions.service';
import { randomUUID } from 'node:crypto';
import { hashPassword, validPassword } from '../../../shared/security/password';
import { isUuid } from '../../../shared/validation/identifiers';
import { AuditService } from '../../audit/services/audit.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { LoginDto } from '../dto/login.dto';
import { Principal } from '../dto/principal.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { WAREHOUSE_ROLES, WarehouseRole } from '../dto/warehouse-role.types';
import { SessionsService } from './sessions.service';
import { AccessService } from './access.service';
import { toUserProfile } from './user-profile';
/** Владелец admin run: user change, session revoke и audit используют один borrowed context. */
@Injectable()
export class UsersService {
  /** Зависимости направлены Users → Access/Sessions; обратной зависимости на Users у них нет. */
  constructor(
    private readonly transactions: IdentityTransactionsService,
    private readonly repository: IdentityRepository,
    private readonly sessions: SessionsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}
  /** Возвращает собственный профиль и grants; CSRF возвращает transport из уже проверенного cookie. */
  async current(principal: Principal) {
    return this.transactions.run(async (context) => {
      const user = await this.sessions.requireSession(context, principal);
      return {
        user,
        warehouseRoles: (await this.repository.roles(context, user.id)).map((row) => ({
          warehouseId: row.warehouse_id,
          role: row.role,
        })),
      };
    });
  }
  /** Создаёт пользователя от admin; password hashing до transaction, запись и безопасный audit атомарны. */
  async createUser(principal: Principal, input: CreateUserDto, correlationId: string) {
    await this.transactions.run((context) => this.access.requireAdmin(context, principal));
    if (
      typeof input.login !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(input.login) ||
      !validPassword(input.password)
    )
      throw new CommandError('VALIDATION_FAILED');
    if (input.systemAdmin !== undefined && typeof input.systemAdmin !== 'boolean')
      throw new CommandError('VALIDATION_FAILED');
    const hash = await hashPassword(input.password);
    const id = randomUUID();
    return this.transactions.run(async (context) => {
      await this.repository.lockAdministration(context);
      await this.access.requireAdmin(context, principal);
      await this.repository.createUser(
        context,
        id,
        input.login.toLowerCase(),
        hash,
        input.systemAdmin ?? false,
      );
      await this.record(context, principal.userId, id, 'identity.user-created', correlationId, {
        active: { after: true },
        systemAdmin: { after: input.systemAdmin ?? false },
      });
      return toUserProfile((await this.repository.lockAndFindUser(context, id))!);
    });
  }
  /** Меняет active/admin/password и отзывает все target sessions при блокировке/смене пароля. Последний active admin защищён. */
  async updateUser(principal: Principal, id: string, input: UpdateUserDto, correlationId: string) {
    if (
      ['active', 'systemAdmin'].some(
        (key) =>
          input[key as 'active' | 'systemAdmin'] !== undefined &&
          typeof input[key as 'active' | 'systemAdmin'] !== 'boolean',
      ) ||
      Object.keys(input).some((key) => !['active', 'systemAdmin', 'password'].includes(key)) ||
      !isUuid(id) ||
      !['active', 'systemAdmin', 'password'].some(
        (key) => input[key as keyof UpdateUserDto] !== undefined,
      ) ||
      (input.password !== undefined && !validPassword(input.password))
    )
      throw new CommandError('VALIDATION_FAILED');
    await this.transactions.run((context) => this.access.requireAdmin(context, principal));
    const hash = input.password === undefined ? undefined : await hashPassword(input.password);
    return this.transactions.run(async (context) => {
      await this.repository.lockAdministration(context);
      await this.requireAdminBeforeUserMutation(context, principal, id);
      const target = await this.repository.lockAndFindUser(context, id, 'update');
      if (!target) throw new CommandError('USER_NOT_FOUND');
      const active = input.active ?? target.active;
      const admin = input.systemAdmin ?? target.system_admin;
      if (
        target.active &&
        target.system_admin &&
        (!active || !admin) &&
        !(await this.repository.otherAdmins(context, id))
      )
        throw new CommandError('LAST_ADMIN_REQUIRED');
      await this.repository.updateUser(context, id, active, admin, hash ?? target.password_hash);
      if (!active || hash !== undefined) await this.sessions.revoke(context, id);
      await this.record(context, principal.userId, id, 'identity.user-updated', correlationId, {
        active: { before: target.active, after: active },
        systemAdmin: { before: target.system_admin, after: admin },
      });
      if (hash !== undefined)
        await this.record(
          context,
          principal.userId,
          id,
          'identity.password-changed',
          correlationId,
        );
      return toUserProfile((await this.repository.lockAndFindUser(context, id))!);
    });
  }
  /** Полная замена grants одного warehouse; lock target user сериализует её с активными command/replay. */
  async setRoles(
    principal: Principal,
    userId: string,
    warehouseId: string,
    roles: WarehouseRole[],
    correlationId: string,
  ): Promise<void> {
    if (
      !isUuid(userId) ||
      !isUuid(warehouseId) ||
      !Array.isArray(roles) ||
      roles.length > 4 ||
      new Set(roles).size !== roles.length ||
      roles.some((role) => !WAREHOUSE_ROLES.includes(role))
    )
      throw new CommandError('VALIDATION_FAILED');
    await this.transactions.run(async (context) => {
      await this.repository.lockAdministration(context);
      await this.requireAdminBeforeUserMutation(context, principal, userId);
      if (!(await this.repository.lockAndFindUser(context, userId, 'update')))
        throw new CommandError('USER_NOT_FOUND');
      const previous = (await this.repository.roles(context, userId))
        .filter((row) => row.warehouse_id === warehouseId.toLowerCase())
        .map((row) => row.role);
      await this.repository.setRoles(context, userId, warehouseId, roles);
      await this.record(
        context,
        principal.userId,
        userId,
        'identity.warehouse-roles-set',
        correlationId,
        { warehouseId: { after: warehouseId } },
      );
      // Каждая добавленная/удалённая роль имеет отдельную безопасную причину. Arrays/credential payload
      // в audit не передаются; это позволяет восстановить изменение прав без расширения JSON allowlist.
      for (const role of previous.filter((role) => !roles.includes(role as WarehouseRole)))
        await this.record(
          context,
          principal.userId,
          userId,
          'identity.warehouse-role-removed',
          correlationId,
          { warehouseId: { after: warehouseId } },
          `${role.replaceAll('_', '-')}-removed`,
        );
      for (const role of roles.filter((role) => !previous.includes(role)))
        await this.record(
          context,
          principal.userId,
          userId,
          'identity.warehouse-role-added',
          correlationId,
          { warehouseId: { after: warehouseId } },
          `${role.replaceAll('_', '-')}-granted`,
        );
    });
  }
  /** Административный отзыв одной/всех сессий целевого пользователя, включая себя; допуск и аудит выполняются в той же транзакции без token. */
  async revokeSession(
    principal: Principal,
    userId: string,
    sessionId: string | undefined,
    correlationId: string,
  ): Promise<void> {
    if (!isUuid(userId) || (sessionId !== undefined && !isUuid(sessionId)))
      throw new CommandError('VALIDATION_FAILED');
    await this.transactions.run(async (context) => {
      await this.repository.lockAdministration(context);
      await this.requireAdminBeforeUserMutation(context, principal, userId);
      if (!(await this.repository.lockAndFindUser(context, userId, 'update')))
        throw new CommandError('USER_NOT_FOUND');
      await this.sessions.revoke(context, userId, sessionId);
      await this.record(
        context,
        principal.userId,
        userId,
        'identity.session-revoked',
        correlationId,
        sessionId ? { sessionId: { after: sessionId } } : undefined,
      );
    });
  }
  /** Единственная процедура первого admin: DB opt-in проверяет CLI, DB group/marker/users проверяются под общей блокировкой. */
  async bootstrap(input: LoginDto): Promise<{ id: string; login: string }> {
    if (
      typeof input.login !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(input.login) ||
      !validPassword(input.password)
    )
      throw new CommandError('VALIDATION_FAILED');
    const hash = await hashPassword(input.password);
    const id = randomUUID();
    return this.transactions.run(async (context) => {
      await this.repository.lockAdministration(context);
      if (!(await this.repository.bootstrapAllowed(context))) throw new CommandError('FORBIDDEN');
      await this.repository.markBootstrap(context);
      await this.repository.createUser(context, id, input.login.toLowerCase(), hash, true);
      await this.audit.write(context, {
        actorType: 'system',
        actorId: '3e949ef0-d232-4acd-80cc-c9c2ab5f984e',
        action: 'identity.bootstrap',
        entityType: 'user',
        entityId: id,
        reasonCode: 'initial-admin',
        correlationId: randomUUID(),
      });
      return { id, login: input.login.toLowerCase() };
    });
  }
  /**
   * Повторяет допуск администратора перед изменением существующего пользователя.
   * @param context Транзакция сценария, которая уже удерживает lockAdministration.
   * @param targetUserId UUID из проверенного DTO/path; регистр UUID не меняет идентичность.
   * Для собственного пользователя UPDATE берётся до session SHARE. Иначе параллельная
   * authenticate держала бы user SHARE и ждала session UPDATE, создавая цикл при повышении user lock.
   * Для чужого пользователя сохраняется порядок caller user/session → target user.
   * @throws UNAUTHORIZED/FORBIDDEN или SQL-ошибка: ни мутация, ни audit не фиксируются.
   */
  private async requireAdminBeforeUserMutation(
    context: TransactionContext,
    principal: Principal,
    targetUserId: string,
  ): Promise<void> {
    if (targetUserId.toLowerCase() === principal.userId.toLowerCase())
      await this.repository.lockAndFindUser(context, principal.userId, 'update');
    await this.access.requireAdmin(context, principal);
  }
  /** Пишет только разрешённые scalar changes, действие/ID/причину; password, session hash, CSRF и login body исключены. */
  private async record(
    context: TransactionContext,
    actorId: string,
    entityId: string,
    action: string,
    correlationId: string,
    changes?: Readonly<Record<string, unknown>>,
    reasonCode = 'identity-administration',
  ): Promise<void> {
    await this.audit.write(context, {
      actorType: 'user',
      actorId,
      entityType: 'user',
      entityId,
      action,
      reasonCode,
      correlationId,
      changes,
    });
  }
}
