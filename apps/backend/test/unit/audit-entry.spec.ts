/** @file Проверяет audit validation/redaction без БД: fail closed и отсутствие произвольного payload. */
import { prepareAuditEntry } from '@backend/modules/audit/audit-entry';
import { auditFixture } from '../support/audit.fixture';

test('keeps only registered field types and masks unknown or unsafe values', () => {
  const entry = prepareAuditEntry(auditFixture({ changes: {
    status: { before: 'draft', after: 'posted', token: 'private-token' },
    quantity: { before: 0, after: 10 }, reserved: { after: 'private-token' },
    password: { after: 'private-password' }, personal: { email: 'person@example.test' },
    productId: { after: { token: 'private-token' } },
  } }));
  expect(entry.changes).toEqual({ status: { before: 'draft', after: 'posted' }, quantity: { before: 0, after: 10 } });
  expect(entry.hasRedactedChanges).toBe(true);
  const stored = JSON.stringify(entry);
  for (const secret of ['private-token', 'private-password', 'person@example.test']) expect(stored).not.toContain(secret);
});

test('valid safe fields and null values survive without redaction', () => {
  const fixture = auditFixture();
  const entry = prepareAuditEntry({ ...fixture, changes: {
    locationId: { before: null, after: fixture.entityId }, onHand: { before: 0, after: 10 },
    status: { after: 'posted' },
  } });
  expect(entry.hasRedactedChanges).toBe(false);
  expect(entry.changes.locationId).toEqual({ before: null, after: fixture.entityId });
});

test.each(['actorId', 'entityId', 'correlationId', 'action', 'reasonCode', 'entityType'] as const)('invalid %s is rejected without revealing its value', field => {
  expect(() => prepareAuditEntry(auditFixture({ [field]: 'private value' }))).toThrow(`Invalid audit ${field}`);
  try { prepareAuditEntry(auditFixture({ [field]: 'private value' })); }
  catch (error) { expect(String(error)).not.toContain('private value'); }
});

test('does not store arbitrary root fields or arrays and rejects invalid actor', () => {
  const fixture = { ...auditFixture(), password: 'private-password' };
  expect(prepareAuditEntry(fixture)).not.toHaveProperty('password');
  expect(() => prepareAuditEntry(auditFixture({ changes: [] as unknown as Record<string, unknown> }))).toThrow('Invalid audit changes');
  expect(() => prepareAuditEntry(auditFixture({ actorType: 'unknown' as 'user' }))).toThrow('Invalid audit actorType');
});

test('invalid quantities and unregistered statuses are removed', () => {
  const entry = prepareAuditEntry(auditFixture({ changes: {
    quantity: { before: -1, after: 0.5 }, onHand: { after: Number.MAX_SAFE_INTEGER + 1 },
    status: { after: 'arbitrary-secret' }, locationId: [],
  } }));
  expect(entry.changes).toEqual({});
  expect(entry.hasRedactedChanges).toBe(true);
});
