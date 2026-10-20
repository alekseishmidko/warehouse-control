/** @file Boundary/contract tests WMS-104: int4 quantity в service, audit и неопубликованной event schema. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isStockQuantity, MAX_STOCK_QUANTITY, requirePositiveQuantity } from '@backend/shared/quantities/quantity';
import { requireUuid } from '@backend/shared/validation/identifiers';
import { normalizeCode, normalizeName } from '@backend/shared/validation/resource-fields';
import { prepareAuditEntry } from '@backend/modules/audit/audit-entry';
import { auditFixture } from '../support/audit.fixture';

test.each([0, -1, 0.5, MAX_STOCK_QUANTITY + 1, NaN, Infinity, '1', null, undefined])('rejects positive receipt quantity %j', value => {
  expect(() => requirePositiveQuantity(value)).toThrow('Invalid quantity');
});

test('SQL integer bounds match service, audit and draft JSON Schema quantity', () => {
  expect(MAX_STOCK_QUANTITY).toBe(2147483647);
  expect(isStockQuantity(0)).toBe(true);
  expect(() => requirePositiveQuantity(MAX_STOCK_QUANTITY)).not.toThrow();
  const schema = JSON.parse(readFileSync(resolve('../../docs/contracts/events/receiving.receipt-posted.v1.schema.json'), 'utf8'));
  // Сверяем числовой контракт; описательные annotations (description) не меняют его смысл.
  expect(schema.properties.payload.properties.lines.items.properties.quantity)
    .toMatchObject({ type: 'integer', minimum: 1, maximum: MAX_STOCK_QUANTITY });
  const example = JSON.parse(readFileSync(resolve('../../docs/contracts/examples/receiving.receipt-posted.v1.json'), 'utf8'));
  for (const line of example.payload.lines) expect(() => requirePositiveQuantity(line.quantity)).not.toThrow();
  expect(prepareAuditEntry(auditFixture({ changes: { onHand: { after: MAX_STOCK_QUANTITY } } })).hasRedactedChanges).toBe(false);
  expect(prepareAuditEntry(auditFixture({ changes: { onHand: { after: MAX_STOCK_QUANTITY + 1 } } })).hasRedactedChanges).toBe(true);
});

test('normalization and identifiers reject invalid values without echoing them', () => {
  expect(normalizeCode(' demo-sku ', 'sku')).toBe('DEMO-SKU');
  expect(normalizeName(' Demo ')).toBe('Demo');
  expect(() => normalizeCode('bad secret value', 'sku')).toThrow('Invalid sku');
  expect(() => normalizeName('')).toThrow('Invalid name');
  expect(() => requireUuid('private', 'productId')).toThrow('Invalid productId');
});

test.each(['test', 'production'])('dev seed refuses NODE_ENV=%s before database connect', NODE_ENV => {
  const result = spawnSync(process.execPath, [resolve('dist/infrastructure/database/seed-dev.js')], {
    env: { ...process.env, NODE_ENV, DATABASE_URL: 'postgresql://user:private-password@127.0.0.1:1/db' }, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Require development mode');
  expect(result.stdout + result.stderr).not.toContain('private-password');
});
