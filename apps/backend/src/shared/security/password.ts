/** @file Password hashing scrypt: фиксированные bounded параметры OWASP, случайная соль, без нормализации пароля. */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
// N=2^17/r=8/p=1: около 128 MiB на операцию. Ограничиваем concurrent work, а не создаём неограниченную очередь.
const N = 131072;
const R = 8;
const P = 1;
let active = 0;
/** Формат dummy выполняет ту же дорогую работу для отсутствующего/повреждённого пользователя. */
export const DUMMY_PASSWORD_HASH = `scrypt$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
/** Проверяет новый пароль без trim/coercion: минимум 15 символов, максимум 128 и 512 UTF-8 bytes. */
export function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length >= 15 &&
    [...value].length <= 128 &&
    Buffer.byteLength(value) <= 512 &&
    Buffer.from(value).toString('utf8') === value &&
    !value.includes('\0')
  );
}
/** Выполняет CPU/memory работу вне транзакции; при перегрузке ошибка не раскрывает пароль. */
async function derive(password: string, salt: string): Promise<Buffer> {
  if (active >= 2) throw new Error('Password hashing capacity exceeded');
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        Buffer.from(salt, 'hex'),
        64,
        { N, r: R, p: P, maxmem: 256 * 1024 * 1024 },
        (error, result) => (error ? reject(new Error('Password hashing failed')) : resolve(result)),
      ),
    );
  } finally {
    active--;
  }
}
/** Создаёт версионируемый hash; неверный пароль отклоняется до scrypt, сырой пароль не возвращается. */
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error('Invalid password');
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt}$${hash.toString('hex')}`;
}
/** Проверяет bounded hash из БД; параметры из произвольной строки никогда не управляют объёмом scrypt. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const valid = /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded);
  const parts = (valid ? encoded : DUMMY_PASSWORD_HASH).split('$');
  const actual = await derive(password, parts[4]);
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex')) && valid;
}
