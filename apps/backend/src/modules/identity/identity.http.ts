/** @file HTTP identity metadata/context и cookie/CSRF policy; нет session token в request-local Principal. */
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Principal } from './dto/principal.dto';
import type { IdentityConfig } from './identity.config';
import { CommandError } from '../../shared/errors/command-error';
import { equalSecret, sessionCsrf } from '../../shared/security/secrets';
/** Серверная metadata, которую нельзя включить клиентским body/header. */
export const IDENTITY_ACCESS = 'warehouse:identity-access';
/** Явно отмечает login/self/admin/business routes; неизвестный business handler запрещён по умолчанию. */
export const IdentityAccess = (kind: 'login' | 'self' | 'admin' | 'business') =>
  SetMetadata(IDENTITY_ACCESS, kind);
const principals = new WeakMap<Request, Principal>();
/** Guard назначает immutable principal только после server-side проверки session. */
export function setPrincipal(request: Request, principal: Principal): void {
  principals.set(request, Object.freeze({ ...principal }));
}
/** Возвращает только проверенный principal; отсутствующая session не превращается в dev actor. */
export function principalOf(request: Request): Principal {
  const value = principals.get(request);
  if (!value) throw new CommandError('UNAUTHORIZED');
  return value;
}
/** DTO/controller получает server actor, не произвольный ID из HTTP body. */
export const SessionPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  principalOf(context.switchToHttp().getRequest()),
);
/** __Host cookie для HTTPS: Secure, Path=/, без Domain; отдельное имя допускается только для локального HTTP. */
export function sessionCookieName(config: IdentityConfig): string {
  return config.secure ? '__Host-wms_session' : 'wms_session';
}
/** Разбирает только одно однозначное значение cookie, без decode/coercion; duplicate token отклоняется. */
export function sessionToken(request: Request, config: IdentityConfig): string | undefined {
  const header = request.headers.cookie;
  if (!header || header.length > 8192) return undefined;
  const values = header
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${sessionCookieName(config)}=`));
  return values.length === 1 ? values[0].slice(values[0].indexOf('=') + 1) : undefined;
}
/** Ставит только session cookie; plaintext token не входит в JSON/body/Location/idempotency storage. */
export function writeSessionCookie(
  response: Response,
  config: IdentityConfig,
  token: string,
): void {
  response.cookie(sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.absoluteSeconds * 1000,
  });
}
/** Очищает cookie с тем же path/policy после committed отзыва сессии. */
export function clearSessionCookie(response: Response, config: IdentityConfig): void {
  response.clearCookie(sessionCookieName(config), {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict',
    path: '/',
  });
}
/**
 * Все небезопасные запросы требуют exact Origin + JSON, CORS не включён.
 * Login без сессии требует custom header (браузерный cross-origin preflight не разрешён).
 * Остальные команды требуют CSRF, HMAC-связанный с session token; SameSite лишь дополнительная защита.
 */
export function requireCsrf(request: Request, config: IdentityConfig, login: boolean): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (
    request.headers.origin !== config.origin ||
    request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new CommandError('CSRF_REJECTED');
  if (login) {
    if (request.headers['x-csrf-protection'] !== '1') throw new CommandError('CSRF_REJECTED');
  } else {
    const token = sessionToken(request, config);
    if (!token || !equalSecret(request.headers['x-csrf-token'], sessionCsrf(token)))
      throw new CommandError('CSRF_REJECTED');
  }
}
