/** @file SQL identity: один borrowed context; жизненный цикл транзакции и бизнес-проверки остаются сервису. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
/** Закрытый DB snapshot; password_hash никогда не возвращать controller через spread. */
export interface UserRow {
  id: string;
  login: string;
  password_hash: string;
  active: boolean;
  system_admin: boolean;
}
/** Поля capability/сроков остаются в infrastructure владельца, наружу идёт только Principal. */
export interface SessionRow {
  id: string;
  user_id: string;
  valid: boolean;
}
/** Все параметры SQL экранируются Drizzle; raw fragments ниже только фиксированные server-side имена блокировок. */
@Injectable()
export class IdentityRepository {
  /**
   * Устанавливает локальные таймауты SQL и транзакции: по 5 секунд до её завершения.
   * Получает context владельца сценария. Не открывает транзакцию и не меняет настройки пула.
   * @throws Ошибка SQL передаётся владельцу; вычисление password hash выполняется вне этих блокировок.
   */
  async setLocalTransactionTimeouts(context: TransactionContext): Promise<void> {
    await transactionClient(context).execute(
      sql`select set_config('statement_timeout','5000',true),set_config('transaction_timeout','5000',true)`,
    );
  }
  /** Находит login без блокировки для дорогой проверки hash; результат позже перечитывается под lock. */
  async findUserByLogin(context: TransactionContext, login: string): Promise<UserRow | null> {
    const result = await transactionClient(context).execute<UserRow & Record<string, unknown>>(
      sql`select * from users where login=${login}`,
    );
    return result.rows[0] ?? null;
  }
  /**
   * Блокирует и читает пользователя по UUID, проверенному сервисом. SHARE удерживает права до commit;
   * UPDATE нужен перед изменением пользователя. Режим выбирают до блокировки сессии.
   * @returns Снимок с внутренним hash либо null; перед HTTP использовать toUserProfile.
   * @throws Ошибка SQL или timeout выходит владельцу транзакции; commit здесь отсутствует.
   */
  async lockAndFindUser(
    context: TransactionContext,
    id: string,
    lockMode: 'share' | 'update' = 'share',
  ): Promise<UserRow | null> {
    const result = await transactionClient(context).execute<UserRow & Record<string, unknown>>(
      sql`select * from users where id=${id} ${lockMode === 'update' ? sql`for update` : sql`for share`}`,
    );
    return result.rows[0] ?? null;
  }
  /** Token lookup не изменяет idle; проверка под session lock выполняется после lock пользователя. */
  async findSessionByTokenHash(
    context: TransactionContext,
    hash: string,
  ): Promise<{ id: string; user_id: string } | null> {
    const result = await transactionClient(context).execute<{ id: string; user_id: string }>(
      sql`select id,user_id from sessions where token_hash=${hash}`,
    );
    return result.rows[0] ?? null;
  }
  /**
   * Блокирует сессию после пользователя и читает её валидность по часам БД после ожидания.
   * UPDATE выбирают для logout или последующего продления срока. Метод срок не изменяет.
   * @returns Снимок с valid либо null, если сессия не принадлежит указанному пользователю.
   * @throws Ошибка SQL выходит владельцу транзакции; блокировка удерживается до commit/rollback.
   */
  async lockSessionAndReadValidity(
    context: TransactionContext,
    id: string,
    userId: string,
    lockMode: 'share' | 'update' = 'share',
  ): Promise<SessionRow | null> {
    const tx = transactionClient(context);
    // Target expressions SELECT FOR UPDATE могут вычислиться до ожидания lock. Отдельно
    // получаем владение строкой, затем новым statement сравниваем часы: истёкшая за время
    // ожидания сессия не должна ожить из-за последующего sliding touch.
    await tx.execute(sql`select id from sessions where id=${id} and user_id=${userId}
      ${lockMode === 'update' ? sql`for update` : sql`for share`}`);
    const result = await tx.execute<SessionRow & Record<string, unknown>>(sql`select id,user_id,
      (revoked_at is null and absolute_expires_at>clock_timestamp() and idle_expires_at>clock_timestamp()) as valid
      from sessions where id=${id} and user_id=${userId}`);
    return result.rows[0] ?? null;
  }
  /**
   * Продлевает idle-срок действующей сессии, ограничивая его абсолютным сроком.
   * @param idleSeconds Проверенное число секунд из IdentityConfig, не значение HTTP-запроса.
   * Вызывающий уже проверил valid и держит UPDATE сессии в этом context. Самостоятельного commit нет.
   * @throws Ошибка UPDATE откатывает весь сценарий у владельца транзакции.
   */
  async refreshSessionIdleDeadline(
    context: TransactionContext,
    id: string,
    idleSeconds: number,
  ): Promise<void> {
    await transactionClient(context)
      .execute(sql`update sessions set idle_expires_at=least(absolute_expires_at,
      clock_timestamp()+${idleSeconds}*interval '1 second') where id=${id}`);
  }
  /** Вставляет только digest; исходный token никогда не передаётся SQL. */
  async createSession(
    context: TransactionContext,
    id: string,
    userId: string,
    hash: string,
    absolute: number,
    idle: number,
  ): Promise<void> {
    await transactionClient(context)
      .execute(sql`with tick as materialized(select clock_timestamp() as at)
      insert into sessions(id,user_id,token_hash,absolute_expires_at,idle_expires_at)
      select ${id},${userId},${hash},tick.at+${absolute}*interval '1 second',tick.at+${idle}*interval '1 second' from tick`);
  }
  /** Возвращает grants только указанного субъекта, не каталог всех складов. */
  async roles(context: TransactionContext, userId: string) {
    return (
      await transactionClient(context).execute<{ warehouse_id: string; role: string }>(
        sql`select warehouse_id,role from warehouse_roles where user_id=${userId} order by warehouse_id,role`,
      )
    ).rows;
  }
  /** Счётчики login/IP фиксируются даже при неверном пароле; вызывающий не откатывает отказ лимита. */
  async loginAttempt(context: TransactionContext, key: string, limit: number): Promise<boolean> {
    const result = await transactionClient(context).execute<{
      attempts: number;
    }>(sql`insert into auth_login_windows(key,attempts,reset_at)
      values(${key},1,clock_timestamp()+interval '15 minutes') on conflict(key) do update set
      attempts=case when auth_login_windows.reset_at<=clock_timestamp() then 1 else least(auth_login_windows.attempts+1,1000) end,
      reset_at=case when auth_login_windows.reset_at<=clock_timestamp() then clock_timestamp()+interval '15 minutes' else auth_login_windows.reset_at end returning attempts`);
    return result.rows[0].attempts <= limit;
  }
  /** Создаёт пользователя; UNIQUE login завершает конкурентный дубль без утечки password hash. */
  async createUser(
    context: TransactionContext,
    id: string,
    login: string,
    hash: string,
    admin: boolean,
  ): Promise<void> {
    await transactionClient(context).execute(
      sql`insert into users(id,login,password_hash,system_admin) values(${id},${login},${hash},${admin})`,
    );
  }
  /** Общая блокировка только изменения admin-набора/bootstrap: предотвращает гонку удаления последнего admin. */
  async lockAdministration(context: TransactionContext): Promise<void> {
    await transactionClient(context).execute(sql`select pg_advisory_xact_lock(202,1)`);
  }
  /** Считает других активных system admins под общим administrative lock. */
  async otherAdmins(context: TransactionContext, id: string): Promise<number> {
    return (
      await transactionClient(context).execute<{ count: number }>(
        sql`select count(*)::int as count from users where system_admin and active and id<>${id}`,
      )
    ).rows[0].count;
  }
  /** Адресный/общий отзыв сохраняет дату вместо удаления сессии. */
  async revoke(context: TransactionContext, userId: string, sessionId?: string): Promise<void> {
    await transactionClient(context)
      .execute(sql`update sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where user_id=${userId}
      ${sessionId ? sql`and id=${sessionId}` : sql``}`);
  }
  /** Обновляет только разрешённые поля; password hash уже вычислен вне транзакции. */
  async updateUser(
    context: TransactionContext,
    id: string,
    active: boolean,
    admin: boolean,
    hash: string,
  ): Promise<void> {
    await transactionClient(context).execute(
      sql`update users set active=${active},system_admin=${admin},password_hash=${hash} where id=${id}`,
    );
  }
  /** Заменяет набор ролей на одном складе; FOR UPDATE users уже удерживает вызывающий. */
  async setRoles(
    context: TransactionContext,
    userId: string,
    warehouseId: string,
    roles: readonly string[],
  ): Promise<void> {
    await transactionClient(context).execute(
      sql`delete from warehouse_roles where user_id=${userId} and warehouse_id=${warehouseId}`,
    );
    for (const role of roles)
      await transactionClient(context).execute(
        sql`insert into warehouse_roles(user_id,warehouse_id,role) values(${userId},${warehouseId},${role})`,
      );
  }
  /** Допуск bootstrap требует отдельной DB group и отсутствия пользователей/неизменяемого маркера. */
  async bootstrapAllowed(context: TransactionContext): Promise<boolean> {
    return (
      await transactionClient(context).execute<{
        allowed: boolean;
      }>(sql`select pg_has_role(current_user,'warehouse_identity_bootstrap','member')
      and not exists(select 1 from identity_bootstrap) and not exists(select 1 from users) as allowed`)
    ).rows[0].allowed;
  }
  /** Маркер создаётся вместе с первым пользователем/аудитом; отдельного commit нет. */
  async markBootstrap(context: TransactionContext): Promise<void> {
    await transactionClient(context).execute(
      sql`insert into identity_bootstrap(key) values('initial')`,
    );
  }
}
