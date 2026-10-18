/** @file Контракт AuditService: validation/redaction до repository, тот же context и проброс ошибки записи. */
import { AuditService } from '@backend/modules/audit/services/audit.service';
import type { TransactionContext } from '@backend/shared/transactions/transaction.port';
import { auditFixture } from '../support/audit.fixture';

test('passes the original context and sanitized record to repository', async () => {
  const repository = { insert: jest.fn().mockResolvedValue('audit-id') };
  const service = new AuditService(repository);
  const context = {} as TransactionContext;
  await expect(service.write(context, auditFixture({ changes: {
    password: { after: 'private-secret' }, status: { after: 'posted' },
  } }))).resolves.toBe('audit-id');
  expect(repository.insert).toHaveBeenCalledTimes(1);
  expect(repository.insert).toHaveBeenCalledWith(context, expect.objectContaining({
    changes: { status: { after: 'posted' } }, hasRedactedChanges: true,
  }));
  expect(JSON.stringify(repository.insert.mock.calls)).not.toContain('private-secret');
});

test('invalid input never reaches repository and write failure propagates', async () => {
  const repository = { insert: jest.fn() };
  const service = new AuditService(repository);
  const context = {} as TransactionContext;
  await expect(service.write(context, auditFixture({ actorId: 'invalid' }))).rejects.toThrow('Invalid audit actorId');
  expect(repository.insert).not.toHaveBeenCalled();
  const error = new Error('repository failed');
  repository.insert.mockRejectedValue(error);
  await expect(service.write(context, auditFixture())).rejects.toBe(error);
});
