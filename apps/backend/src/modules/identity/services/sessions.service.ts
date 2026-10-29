/** @file Жизненный цикл серверных сессий: создание digest, проверка/idle touch и отзыв; без HTTP и правил складских ролей. */
import { Inject, Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { CommandError } from '../../../shared/errors/command-error';
import { IdentityRepository } from '../repositories/identity.repository';
import { IdentityTransactionsService } from './identity-transactions.service';
import { randomUUID } from 'node:crypto';
import { isSecret, newSecret, secretHash, sessionCsrf } from '../../../shared/security/secrets';
import { IDENTITY_CONFIG, IdentityConfig } from '../identity.config';
import { Principal } from '../dto/principal.dto';
import type { UserProfileDto } from '../dto/user-profile.dto';
import { toUserProfile } from './user-profile';
/** User lock всегда предшествует session lock. Заимствованный context не коммитится сервисом. */
@Injectable()
export class SessionsService {
  /** Явная policy также используется transport для cookie; SQL остаётся внутреннему repository. */
  constructor(
    private readonly transactions: IdentityTransactionsService,
    private readonly repository: IdentityRepository,
    @Inject(IDENTITY_CONFIG) readonly config: IdentityConfig,
  ) {}
  /**
   * Создаёт session в context login после повторной проверки active/hash под user lock.
   * @param userId Проверенный сервером субъект, не значение из HTTP body.
   * @returns Raw token только для cookie и связанный CSRF; БД получает лишь SHA-256 digest.
   * @throws Ошибка INSERT выходит владельцу run; cookie до commit не выдаётся.
   */
  async create(context: TransactionContext, userId: string) {
    const token = newSecret();
    await this.repository.createSession(
      context,
      randomUUID(),
      userId,
      secretHash(token),
      this.config.absoluteSeconds,
      this.config.idleSeconds,
    );
    return { token, csrfToken: sessionCsrf(token) };
  }
  /** Guard token lookup + sliding idle touch, без доверия actor headers; возвращает только ID principal. */
  async authenticate(token: unknown): Promise<Principal> {
    if (!isSecret(token)) throw new CommandError('UNAUTHORIZED');
    return this.transactions.run(async (context) => {
      const found = await this.repository.sessionByHash(context, secretHash(token));
      if (!found) throw new CommandError('UNAUTHORIZED');
      const principal = { userId: found.user_id, sessionId: found.id };
      await this.requireSession(context, principal, this.config.idleSeconds);
      return Object.freeze(principal);
    });
  }
  /** Перечитывает актуальные user/session под locks до business/replay commit; возвращает безопасный профиль, ошибка — UNAUTHORIZED. */
  async requireSession(
    context: TransactionContext,
    principal: Principal,
    touchSeconds?: number,
  ): Promise<UserProfileDto> {
    const user = await this.repository.user(context, principal.userId);
    if (
      !user?.active ||
      !(await this.repository.session(context, principal.sessionId, user.id, touchSeconds))?.valid
    )
      throw new CommandError('UNAUTHORIZED');
    return toUserProfile(user);
  }
  /** Logout идёт отдельно от business idempotency; session token/credentials не сохраняются в command storage. */
  async logout(principal: Principal): Promise<void> {
    await this.transactions.run(async (context) => {
      await this.requireSession(context, principal);
      await this.revoke(context, principal.userId, principal.sessionId);
    });
  }
  /**
   * Внутренний borrowed-context отзыв одной/всех сессий. Вызывающий предварительно проверяет
   * self/admin допуск и держит user lock; UsersService добавляет admin audit в тот же commit.
   * Метод не открывает run и не принимает browser token; повторный отзыв безопасен.
   */
  async revoke(context: TransactionContext, userId: string, sessionId?: string): Promise<void> {
    await this.repository.revoke(context, userId, sessionId);
  }
}
