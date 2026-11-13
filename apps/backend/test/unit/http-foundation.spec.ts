/** @file WMS-107 unit invariants: canonical hashing input и fail-closed dev actor config, без Docker. */
import { canonicalJson, canonicalSnapshotJson } from '@backend/shared/serialization/canonical-json';
import { validateEnvironment } from '@backend/infrastructure/config/environment';
const valid = {
  DATABASE_URL: 'postgresql://offline@localhost/db',
  NODE_ENV: 'test',
  HTTP_HOST: '127.0.0.1',
  DEV_ACTOR_ENABLED: 'true',
  DEV_ACTOR_ID: 'dbb37b21-1c4a-4b32-9307-148df1647f4c',
};
test('canonical JSON sorts nested object keys and preserves array order', () => {
  expect(canonicalJson({ b: 2, a: { z: 3, a: 1 } })).toBe(
    canonicalJson({ a: { a: 1, z: 3 }, b: 2 }),
  );
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
});
// Каждое значение обёрнуто в row: иначе Jest воспринял бы тестируемый массив как список аргументов.
test.each(
  [undefined, NaN, Infinity, BigInt(1), new Date(), { value: undefined }, [, 1]].map((input) => [
    input,
  ]),
)('rejects non JSON data %j', (input) => {
  expect(() => canonicalJson(input)).toThrow();
});
test('cycles/getters/toJSON cannot create side effects or unstable hashes', () => {
  const input: Record<string, unknown> = {};
  input.self = input;
  expect(() => canonicalJson(input)).toThrow();
  const getter = jest.fn();
  // Недостаточно получить ошибку: отдельно доказываем, что getter/toJSON не был выполнен при hashing.
  expect(() =>
    canonicalJson(Object.defineProperty({}, 'value', { enumerable: true, get: getter })),
  ).toThrow();
  const array = [1];
  Object.defineProperty(array, '0', { get: getter });
  expect(() => canonicalJson(array)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => canonicalJson({ toJSON: getter })).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
test('dev actor is removed, even explicit test loopback opt-in cannot enable it', () => {
  expect(validateEnvironment({ DATABASE_URL: valid.DATABASE_URL })).not.toHaveProperty(
    'devActorId',
  );
  expect(() => validateEnvironment(valid)).toThrow('DEV_ACTOR_ENABLED');
});
test.each([
  { NODE_ENV: 'production' },
  { NODE_ENV: undefined },
  { HTTP_HOST: '0.0.0.0' },
  { HTTP_HOST: '::' },
  { DEV_ACTOR_ID: 'private-secret' },
  { DEV_ACTOR_ID: undefined },
  { DEV_ACTOR_ENABLED: 'yes' },
])('invalid dev isolation %j fails startup without leaking input', (override) => {
  expect(() => validateEnvironment({ ...valid, ...override })).toThrow();
  try {
    validateEnvironment({ ...valid, ...override });
  } catch (error) {
    expect(String(error)).not.toContain('private-secret');
  }
});

test('request byte budget does not truncate server-owned snapshots; JSON safety is shared', () => {
  const value = { history: 'x'.repeat(262145) };
  expect(() => canonicalJson(value)).toThrow('REQUEST_TOO_LARGE');
  expect(JSON.parse(canonicalSnapshotJson(value))).toEqual(value);
  const getter = jest.fn();
  expect(() =>
    canonicalSnapshotJson(Object.defineProperty({}, 'secret', { enumerable: true, get: getter })),
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => canonicalSnapshotJson(cyclic)).toThrow();
});

test('request budget stops expansion of shared references before traversing the full graph', () => {
  let value: unknown = { leaf: 'value' };
  for (let depth = 0; depth < 17; depth++) value = { left: value, right: value };
  const descriptor = Object.getOwnPropertyDescriptor;
  let reads = 0;
  try {
    // Считаем работу, а не wall time: тест не зависит от скорости CPU/GC.
    // Подмена действует только во время синхронного вызова и всегда снимается.
    Object.getOwnPropertyDescriptor = (object: object, key: PropertyKey) => {
      reads++;
      return descriptor(object, key);
    };
    expect(() => canonicalJson(value)).toThrow('REQUEST_TOO_LARGE');
  } finally {
    Object.getOwnPropertyDescriptor = descriptor;
  }
  // Каждому посещённому полю валидного JSON нужны байты output. После budget
  // нельзя продолжать экспоненциальное разворачивание оставшейся части DAG.
  expect(reads).toBeLessThan(256 * 1024);
});

test('request budget counts exact UTF-8, escaping and object punctuation boundaries', () => {
  const budget = 256 * 1024;
  for (const value of [
    'я'.repeat((budget - 2) / 2),
    '\n'.repeat((budget - 2) / 2),
    { value: 'x'.repeat(budget - 12) },
  ]) {
    const expected = JSON.stringify(value);
    expect(Buffer.byteLength(expected, 'utf8')).toBe(budget);
    expect(canonicalJson(value)).toBe(expected);
  }
  expect(() => canonicalJson('я'.repeat((budget - 2) / 2) + 'x')).toThrow('REQUEST_TOO_LARGE');
});

test.each([canonicalJson, canonicalSnapshotJson])(
  'both serializers preserve wire values, aliases, null-prototype records and depth boundary: %p',
  (serialize) => {
    const shared = { text: 'quote"\n\\я', number: -0 };
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    record.value = shared;
    const input = { a: [], b: [null, true, false, 1.5], c: record, d: shared };
    expect(serialize(input)).toBe(
      '{"a":[],"b":[null,true,false,1.5],"c":{"value":{"number":0,"text":"quote\\\"\\n\\\\я"}},"d":{"number":0,"text":"quote\\\"\\n\\\\я"}}',
    );
    let nested: unknown = null;
    for (let depth = 0; depth < 64; depth++) nested = [nested];
    expect(serialize(nested)).toBe('['.repeat(64) + 'null' + ']'.repeat(64));
    expect(() => serialize([nested])).toThrow('VALIDATION_FAILED');
  },
);
