/** @file Контракт cursor: фильтры, размер, UUID и точность времени; SQL границы проверяются PostgreSQL suite. */
import { preparePageRequest, encodePageCursor } from '@backend/shared/pagination/keyset-page';
import { randomUUID } from 'node:crypto';
const filters = { warehouseId: randomUUID(), status: 'posted' };
/** Повреждение структуры не должно попадать в SQL или раскрывать внутреннюю ошибку parser. */
const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
test('cursor binds resource and normalized filters, allows a different page size, preserves microseconds', () => {
  const page = preparePageRequest('receipts', filters);
  const position = { id: randomUUID(), time: '2026-11-04T10:00:00.123456Z' };
  const cursor = encodePageCursor(page, position);
  expect(preparePageRequest('receipts', filters, '100', cursor).position).toEqual(position);
  expect(() => preparePageRequest('orders', filters, '20', cursor)).toThrow('VALIDATION_FAILED');
  expect(() =>
    preparePageRequest('receipts', { ...filters, status: 'draft' }, '20', cursor),
  ).toThrow('VALIDATION_FAILED');
  expect(() =>
    preparePageRequest('receipts', { ...filters, warehouseId: randomUUID() }, '20', cursor),
  ).toThrow('VALIDATION_FAILED');
});
test.each(['0', '101', '-1', '1.5', '01', '1e2', ' 2'])('limit %s is rejected', (limit) => {
  expect(() => preparePageRequest('x', filters, limit)).toThrow('VALIDATION_FAILED');
});
test.each([
  'not-json',
  '*',
  'a'.repeat(513),
  raw(null),
  raw([]),
  raw({ v: 2 }),
  raw({ v: 1, id: 'bad' }),
])('malformed cursor is rejected safely', (cursor) => {
  expect(() => preparePageRequest('x', filters, '20', cursor)).toThrow('VALIDATION_FAILED');
});
test.each([
  '0000-01-01T00:00:00.000000Z',
  '2026-02-30T10:00:00.123456Z',
  '2026-11-04T10:00:00.123Z',
  '2026-11-04T10:00:00.123456+00:00',
])('timestamp %s cannot corrupt SQL position', (time) => {
  const page = preparePageRequest('x', filters);
  expect(() =>
    preparePageRequest(
      'x',
      filters,
      '20',
      raw({ v: 1, scope: page.scope, id: randomUUID(), time }),
    ),
  ).toThrow('VALIDATION_FAILED');
});

test('optional filters preserve existing cursor scope without mutating caller data', () => {
  const input = Object.freeze({ ...filters, productId: undefined });
  const original = preparePageRequest('receipts', filters);
  const cursor = encodePageCursor(original, { id: randomUUID() });
  expect(preparePageRequest('receipts', input, '50', cursor).scope).toBe(original.scope);
  expect(input).toEqual({ ...filters, productId: undefined });
  // Пустая строка не равна отсутствующему фильтру: только undefined исключён из scope.
  expect(preparePageRequest('receipts', { ...filters, productId: '' }).scope).not.toBe(
    original.scope,
  );
});

test.each([{ extra: 'ignored?' }, { time: 123 }, { time: null }, { id: 'bad' }])(
  'valid scope does not bypass cursor structure validation: %j',
  (override) => {
    const page = preparePageRequest('receipts', filters);
    const cursor = raw({ v: 1, scope: page.scope, id: randomUUID(), ...override });
    expect(() => preparePageRequest('receipts', filters, '20', cursor)).toThrow(
      'VALIDATION_FAILED',
    );
  },
);
