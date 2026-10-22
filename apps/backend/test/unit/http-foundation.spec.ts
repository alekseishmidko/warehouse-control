/** @file WMS-107 unit invariants: canonical hashing input и fail-closed dev actor config, без Docker. */
import { canonicalJson } from '@backend/shared/serialization/canonical-json';
import { validateEnvironment } from '@backend/infrastructure/config/environment';
const valid = { DATABASE_URL: 'postgresql://offline@localhost/db', NODE_ENV: 'test', HTTP_HOST: '127.0.0.1',
  DEV_ACTOR_ENABLED: 'true', DEV_ACTOR_ID: 'dbb37b21-1c4a-4b32-9307-148df1647f4c' };
test('canonical JSON sorts nested object keys and preserves array order', () => {
  expect(canonicalJson({ b: 2, a: { z: 3, a: 1 } })).toBe(canonicalJson({ a: { a: 1, z: 3 }, b: 2 }));
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
});
// Каждое значение обёрнуто в row: иначе Jest воспринял бы тестируемый массив как список аргументов.
test.each([undefined, NaN, Infinity, BigInt(1), new Date(), { value: undefined }, [, 1]].map(input => [input]))('rejects non JSON data %j', input => {
  expect(() => canonicalJson(input)).toThrow();
});
test('cycles/getters/toJSON cannot create side effects or unstable hashes', () => {
  const input: Record<string, unknown> = {}; input.self = input;
  expect(() => canonicalJson(input)).toThrow();
  const getter = jest.fn();
  // Недостаточно получить ошибку: отдельно доказываем, что getter/toJSON не был выполнен при hashing.
  expect(() => canonicalJson(Object.defineProperty({}, 'value', { enumerable: true, get: getter }))).toThrow();
  const array = [1]; Object.defineProperty(array, '0', { get: getter });
  expect(() => canonicalJson(array)).toThrow(); expect(getter).not.toHaveBeenCalled();
  expect(() => canonicalJson({ toJSON: getter })).toThrow(); expect(getter).not.toHaveBeenCalled();
});
test('default actor disabled; enabling requires explicit dev/test and loopback UUID', () => {
  expect(validateEnvironment({ DATABASE_URL: valid.DATABASE_URL }).devActorId).toBeUndefined();
  expect(validateEnvironment(valid).devActorId).toBe(valid.DEV_ACTOR_ID);
});
test.each([
  { NODE_ENV: 'production' }, { NODE_ENV: undefined }, { HTTP_HOST: '0.0.0.0' }, { HTTP_HOST: '::' },
  { DEV_ACTOR_ID: 'private-secret' }, { DEV_ACTOR_ID: undefined }, { DEV_ACTOR_ENABLED: 'yes' },
])('invalid dev isolation %j fails startup without leaking input', override => {
  expect(() => validateEnvironment({ ...valid, ...override })).toThrow();
  try { validateEnvironment({ ...valid, ...override }); } catch (error) { expect(String(error)).not.toContain('private-secret'); }
});
