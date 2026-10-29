/** @file Unit security contracts: explicit policy, bounded password hashing и CSRF/session-secret формат без Docker. */
import {
  hashPassword,
  validPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
} from '@backend/shared/security/password';
import { newSecret, secretHash, sessionCsrf, equalSecret } from '@backend/shared/security/secrets';
import { validateIdentityConfig } from '@backend/modules/identity/identity.config';
const policy = {
  NODE_ENV: 'test',
  AUTH_ORIGIN: 'http://127.0.0.1:3000',
  AUTH_SESSION_ABSOLUTE_SECONDS: '600',
  AUTH_SESSION_IDLE_SECONDS: '300',
};
/** Нет неутверждённых defaults; malformed origin с credentials не отражается в исключении. */
test('explicit auth policy rejects missing/unsafe origin or invalid timeouts', () => {
  expect(validateIdentityConfig(policy)).toMatchObject({
    absoluteSeconds: 600,
    idleSeconds: 300,
    secure: false,
  });
  for (const change of [
    { AUTH_ORIGIN: undefined },
    { AUTH_ORIGIN: 'http://secret@\u0000' },
    { NODE_ENV: 'production' },
    { AUTH_SESSION_IDLE_SECONDS: '601' },
    { AUTH_SESSION_ABSOLUTE_SECONDS: undefined },
    { AUTH_SESSION_IDLE_SECONDS: '30.5' },
  ]) {
    expect(() => validateIdentityConfig({ ...policy, ...change })).toThrow();
    try {
      validateIdentityConfig({ ...policy, ...change });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  }
});
/** Ровно 256 бит, разные tokens дают разные digest/CSRF; Unicode header не вызывает timingSafeEqual exception. */
test('opaque tokens are high-entropy, only digests persist and csrf is session-bound', () => {
  const a = newSecret();
  const b = newSecret();
  expect(a).toHaveLength(43);
  expect(a).not.toBe(b);
  expect(secretHash(a)).toHaveLength(64);
  expect(secretHash(a)).not.toContain(a);
  expect(sessionCsrf(a)).not.toBe(sessionCsrf(b));
  expect(equalSecret(sessionCsrf(a), sessionCsrf(a))).toBe(true);
  expect(equalSecret('é'.repeat(43), sessionCsrf(a))).toBe(false);
});
/** Salt меняет hash при одном пароле; неизвестный формат не управляет затратами scrypt. */
test('password hashing preserves exact secret, salts and verifies safely', async () => {
  const password = 'Synthetic-Password-2026!';
  const hash = await hashPassword(password);
  expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
  expect(hash).not.toContain(password);
  expect(await verifyPassword(password, hash)).toBe(true);
  expect(await verifyPassword(password + 'x', hash)).toBe(false);
  expect(await verifyPassword(password, 'scrypt$999999999$8$1$bad')).toBe(false);
  expect(await verifyPassword(password, DUMMY_PASSWORD_HASH)).toBe(false);
  expect(validPassword('short')).toBe(false);
  expect(validPassword('x'.repeat(129))).toBe(false);
  expect(validPassword('x'.repeat(15) + '\ud800')).toBe(false);
});
