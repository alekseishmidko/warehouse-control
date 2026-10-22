/** @file Временная изолированная dev/test identity; не production authentication и не доверие HTTP actor headers. */
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DATABASE_CONFIG } from '../database/database.module';
import type { RuntimeConfig } from '../config/environment';
import { CommandError } from '../../shared/errors/command-error';
import { isUuid } from '../../shared/validation/identifiers';
import { COMMAND_OPERATION, TECHNICAL_ROUTE } from './http-command.decorator';
import { correlationIdOf, setCommandScope } from './request-context';
/** Не даёт будущим бизнес-routes случайно стать public: исключаются только явно технические handlers. */
@Injectable()
export class DevActorGuard implements CanActivate {
  /** DI передаёт validated config; guard не читает process.env и не доверяет значениям HTTP actor headers. */
  constructor(@Inject(DATABASE_CONFIG) private readonly config: RuntimeConfig, private readonly reflector: Reflector) {}
  /**
   * Разрешает технический handler или проверяет локальный opt-in actor до DTO/controller.
   * @returns true при разрешённом доступе; для команды дополнительно фиксирует frozen CommandScope.
   * @throws CommandError при недоступной dev identity или отсутствующем/невалидном UUID key.
   * Не выполняет SQL и не создаёт transaction; production authentication реализуется отдельно.
   */
  canActivate(context: ExecutionContext): boolean {
    // Исключение по явным metadata, не по клиентскому URL: добавленная business route
    // останется закрытой, если разработчик не пометил её как техническую.
    if (this.reflector.getAllAndOverride(TECHNICAL_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const peer = request.socket.remoteAddress;
    // Config уже проверен на startup, но повторная проверка защищает от ошибочного DI override.
    // Проверяем socket peer напрямую; forwarded headers не дают включить actor через proxy.
    if (!this.config.devActorId || !isUuid(this.config.devActorId) || !['development', 'test'].includes(this.config.nodeEnv)
      || !['127.0.0.1', '::1'].includes(this.config.httpHost) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '')
      || ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].some(header => request.headers[header] !== undefined)) {
      throw new CommandError('DEV_ACTOR_UNAVAILABLE');
    }
    const operation = this.reflector.get<string>(COMMAND_OPERATION, context.getHandler());
    // Только metadata серверного метода определяют operation. GET без HttpCommand
    // не требует idempotency key, но выше всё равно прошёл проверку dev actor.
    if (operation) {
      const key = request.headers['idempotency-key'];
      if (key === undefined) throw new CommandError('IDEMPOTENCY_KEY_REQUIRED');
      if (typeof key !== 'string' || !isUuid(key)) throw new CommandError('INVALID_IDEMPOTENCY_KEY');
      // Body и X-Actor-Id намеренно не читаются: actor один и задан server config.
      setCommandScope(request, { actorType: 'user', actorId: this.config.devActorId, operation,
        key: key.toLowerCase(), correlationId: correlationIdOf(request) });
    }
    return true;
  }
}
