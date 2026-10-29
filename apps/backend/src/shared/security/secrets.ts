/** @file Случайные секреты и безопасные сравнения: без HTTP/БД и без вывода чувствительных значений. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
/** Создаёт 256-битный URL-safe token; вызывающий хранит/логирует только digest, не сам секрет. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}
/** SHA-256 подходит для высокоэнтропийного случайного token; для пароля применять password.ts. */
export function secretHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
/** Проверяет единственный канонический формат токена до поиска в БД. */
export function isSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
/** CSRF связан с конкретной сессией; браузер получает его JSON-ответом, session cookie остаётся HttpOnly. */
export function sessionCsrf(token: string): string {
  return createHmac('sha256', token).update('warehouse:csrf:v1').digest('base64url');
}
/** Сравнивает секреты одинаковой длины без раннего выхода по первому несовпадающему байту. */
export function equalSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
