/** @file Глобальная session-boundary: нет dev actor fallback; все нетехнические handlers должны явно объявить доступ. */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionsService } from '../../modules/identity/services/sessions.service';
import { AccessService } from '../../modules/identity/services/access.service';
import {
  IDENTITY_ACCESS,
  requireCsrf,
  sessionToken,
  setPrincipal,
} from '../../modules/identity/identity.http';
import { COMMAND_OPERATION, TECHNICAL_ROUTE } from './http-command.decorator';
import { correlationIdOf, setCommandScope } from './request-context';
import { CommandError } from '../../shared/errors/command-error';
import { isUuid } from '../../shared/validation/identifiers';
/** Policy склада дополнительно выполняется в transaction callback до dedup, guard лишь создаёт trusted actor. */
@Injectable()
export class AuthGuard implements CanActivate {
  /** SessionsService/AccessService владеют проверками, guard не обращается к чужим repositories. */
  constructor(
    private readonly sessions: SessionsService,
    private readonly access: AccessService,
    private readonly reflector: Reflector,
  ) {}
  /** Проверяет session/CSRF, default-deny metadata и UUID ключа до controller; бросает только безопасные CommandError. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride(TECHNICAL_ROUTE, targets)) return true;
    const access = this.reflector.getAllAndOverride<string>(IDENTITY_ACCESS, targets);
    const request = context.switchToHttp().getRequest<Request>();
    if (access === 'login') {
      requireCsrf(request, this.sessions.config, true);
      return true;
    }
    const principal = await this.sessions.authenticate(sessionToken(request, this.sessions.config));
    if (!['self', 'admin', 'business'].includes(access ?? '')) throw new CommandError('FORBIDDEN');
    requireCsrf(request, this.sessions.config, false);
    if (access === 'admin') await this.access.run((tx) => this.access.requireAdmin(tx, principal));
    setPrincipal(request, principal);
    const operation = this.reflector.get<string>(COMMAND_OPERATION, context.getHandler());
    if (operation) {
      const key = request.headers['idempotency-key'];
      if (key === undefined) throw new CommandError('IDEMPOTENCY_KEY_REQUIRED');
      if (typeof key !== 'string' || !isUuid(key))
        throw new CommandError('INVALID_IDEMPOTENCY_KEY');
      setCommandScope(request, {
        actorType: 'user',
        actorId: principal.userId,
        operation,
        key: key.toLowerCase(),
        correlationId: correlationIdOf(request),
      });
    }
    return true;
  }
}
