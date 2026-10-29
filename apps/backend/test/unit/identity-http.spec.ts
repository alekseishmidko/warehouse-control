/** @file Чистые HTTP security boundaries identity: однозначная cookie, доверенный principal и обязательный CSRF; без Docker. */
import type { Request } from 'express';
import {
  principalOf,
  setPrincipal,
  sessionToken,
  requireCsrf,
} from '@backend/modules/identity/identity.http';
import { validateIdentityConfig } from '@backend/modules/identity/identity.config';
import { newSecret, sessionCsrf } from '@backend/shared/security/secrets';
const config = validateIdentityConfig({
  NODE_ENV: 'test',
  AUTH_ORIGIN: 'http://127.0.0.1:3000',
  AUTH_SESSION_ABSOLUTE_SECONDS: '600',
  AUTH_SESSION_IDLE_SECONDS: '300',
});
/** Request fixture содержит только реальные поля boundary, не подменяет CSRF алгоритм. */
const req = (method: string, headers: Request['headers'] = {}) => ({ method, headers }) as Request;

/** Значения actor из body/headers не создают server-side principal; назначенный объект не мутируется клиентом. */
test('principal requires server assignment, is immutable and isolated per request', () => {
  const a = req('GET', { 'x-actor-id': 'untrusted' });
  const b = req('GET');
  expect(() => principalOf(a)).toThrow('UNAUTHORIZED');
  const principal = { userId: 'user', sessionId: 'session' };
  setPrincipal(a, principal);
  principal.userId = 'changed';
  expect(principalOf(a)).toEqual({ userId: 'user', sessionId: 'session' });
  expect(Object.isFrozen(principalOf(a))).toBe(true);
  expect(() => principalOf(b)).toThrow('UNAUTHORIZED');
});

/** Parser не декодирует capability и не выбирает произвольное значение неоднозначной cookie. */
test.each([
  [undefined, undefined],
  ['', undefined],
  ['other=value', undefined],
  ['wms_session=a; wms_session=b', undefined],
  ['wms_session=' + 'x'.repeat(8192), undefined],
  ['other=value; wms_session=token; another=x', 'token'],
  ['wms_session=%61', '%61'],
  ['__Host-wms_session=https-only', undefined],
])('session cookie parser rejects ambiguity: %s', (cookie, expected) => {
  expect(sessionToken(req('GET', { cookie }), config)).toBe(expected);
});

/** Safe методы не требуют CSRF, но это не отменяет session guard — он проверяется HTTP integration. */
test.each(['GET', 'HEAD', 'OPTIONS'])('%s skips only CSRF check', (method) => {
  expect(() => requireCsrf(req(method), config, false)).not.toThrow();
});

/** Все unsafe методы требуют exact Origin, JSON и CSRF, связанный именно с текущей session. */
test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s requires valid session-bound csrf', (method) => {
  const token = newSecret();
  const headers = {
    origin: config.origin,
    'content-type': 'Application/JSON; charset=utf-8',
    cookie: `wms_session=${token}`,
    'x-csrf-token': sessionCsrf(token),
  };
  expect(() => requireCsrf(req(method, headers), config, false)).not.toThrow();
  for (const change of [
    { origin: undefined },
    { origin: 'https://attacker.example' },
    { 'content-type': undefined },
    { 'content-type': 'text/plain' },
    { cookie: undefined },
    { cookie: 'wms_session=a; wms_session=b' },
    { 'x-csrf-token': undefined },
    { 'x-csrf-token': sessionCsrf(newSecret()) },
    { 'x-csrf-token': ['not', 'one'] },
  ])
    expect(() => requireCsrf(req(method, { ...headers, ...change }), config, false)).toThrow(
      'CSRF_REJECTED',
    );
});

/** У login ещё нет session: custom header обязателен в дополнение к exact Origin/JSON. */
test('login accepts only explicit csrf protection header', () => {
  const headers = {
    origin: config.origin,
    'content-type': 'application/json',
    'x-csrf-protection': '1',
  };
  expect(() => requireCsrf(req('POST', headers), config, true)).not.toThrow();
  for (const value of [undefined, '0', ['1']])
    expect(() =>
      requireCsrf(req('POST', { ...headers, 'x-csrf-protection': value }), config, true),
    ).toThrow('CSRF_REJECTED');
});
