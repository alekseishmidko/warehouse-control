/** @file Отдельная validated auth-конфигурация; сроки задаёт оператор явно, нет неутверждённых runtime defaults. */
export interface IdentityConfig {
  readonly origin: string;
  readonly secure: boolean;
  readonly absoluteSeconds: number;
  readonly idleSeconds: number;
}
/** DI token позволяет tests/offline generation задать синтетические сроки без process.env mutations. */
export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');
/** Проверяет origin и секунды, не выводя URL/значения; production требует HTTPS, локальный HTTP — только dev/test loopback. */
export function validateIdentityConfig(env: NodeJS.ProcessEnv): IdentityConfig {
  let origin: URL;
  try {
    origin = new URL(env.AUTH_ORIGIN ?? 'invalid:');
  } catch {
    throw new Error('Invalid AUTH_ORIGIN');
  }
  if (
    origin.origin !== env.AUTH_ORIGIN ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    !['https:', 'http:'].includes(origin.protocol) ||
    (origin.protocol === 'http:' &&
      (!['development', 'test'].includes(env.NODE_ENV ?? '') ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Invalid AUTH_ORIGIN');
  /** Явные секунды: фиксированный верхний bound предотвращает бесконечные/переполненные сроки. */
  const seconds = (name: string) => {
    const value = env[name];
    if (!value || !/^\d+$/.test(value) || Number(value) < 30 || Number(value) > 86400)
      throw new Error('Invalid session timeout configuration');
    return Number(value);
  };
  const absoluteSeconds = seconds('AUTH_SESSION_ABSOLUTE_SECONDS');
  const idleSeconds = seconds('AUTH_SESSION_IDLE_SECONDS');
  if (idleSeconds > absoluteSeconds) throw new Error('Invalid session timeout ordering');
  return Object.freeze({
    origin: origin.origin,
    secure: origin.protocol === 'https:',
    absoluteSeconds,
    idleSeconds,
  });
}
