/** @file Вход/выход: координация credentials и сессий; password hashing с bounded work выполняется вне DB locks. */
import { Injectable } from '@nestjs/common';
import { CommandError } from '../../../shared/errors/command-error';
import { IdentityRepository } from '../repositories/identity.repository';
import { IdentityTransactionsService } from './identity-transactions.service';
import {
  DUMMY_PASSWORD_HASH,
  validPassword,
  verifyPassword,
} from '../../../shared/security/password';
import { secretHash } from '../../../shared/security/secrets';
import { LoginDto } from '../dto/login.dto';
import { Principal } from '../dto/principal.dto';
import { SessionsService } from './sessions.service';
import { toUserProfile } from './user-profile';
/** Координатор login; SQL rate windows и read принадлежат тому же identity module. */
@Injectable()
export class AuthService {
  /** SessionsService владеет cookie policy и session SQL; циклических вызовов нет. */
  constructor(
    private readonly transactions: IdentityTransactionsService,
    private readonly repository: IdentityRepository,
    private readonly sessions: SessionsService,
  ) {}
  /**
   * Проверяет недоверенный LoginDto и socket peer; forwarded headers сюда не передаются.
   * Rate/read/session — три отдельных run, scrypt между read и session не держит DB locks.
   * @returns Safe user, CSRF и raw token для HttpOnly cookie после commit, не публичный JSON token.
   * @throws VALIDATION_FAILED, TOO_MANY_REQUESTS, общий UNAUTHORIZED для absent/blocked/wrong
   * credentials; SERVICE_UNAVAILABLE при перегрузке scrypt. Ошибка SQL откатывает session write.
   */
  async login(input: LoginDto, peer: string) {
    if (
      typeof input.login !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(input.login) ||
      !validPassword(input.password)
    )
      throw new CommandError('VALIDATION_FAILED');
    const login = input.login.toLowerCase();
    const allowed = await this.transactions.run(async (context) => {
      // Сначала IP: заблокированный источник не может раздувать таблицу случайными login keys.
      // Порядок locks постоянный; boolean возвращается наружу, чтобы отказ не откатил счётчики.
      if (!(await this.repository.loginAttempt(context, `peer:${secretHash(peer)}`, 50)))
        return false;
      return this.repository.loginAttempt(context, `login:${secretHash(login)}`, 10);
    });
    if (!allowed) throw new CommandError('TOO_MANY_REQUESTS');
    const candidate = await this.transactions.run((context) =>
      this.repository.byLogin(context, login),
    );
    let verified: boolean;
    try {
      verified = await verifyPassword(
        input.password,
        candidate?.password_hash ?? DUMMY_PASSWORD_HASH,
      );
    } catch {
      throw new CommandError('SERVICE_UNAVAILABLE');
    }
    if (!candidate || !verified || !candidate.active) throw new CommandError('UNAUTHORIZED');
    const result = await this.transactions.run(async (context) => {
      // Hash проверялся без locks; смена пароля/блокировка за это время не должна принять старый пароль.
      const current = await this.repository.user(context, candidate.id);
      if (!current?.active || current.password_hash !== candidate.password_hash)
        throw new CommandError('UNAUTHORIZED');
      const session = await this.sessions.create(context, current.id);
      return { ...session, user: toUserProfile(current) };
    });
    return result;
  }
  /** Делегирует self logout владельцу сессий; transport очищает cookie только после успешного commit. */
  async logout(principal: Principal): Promise<void> {
    await this.sessions.logout(principal);
  }
}
