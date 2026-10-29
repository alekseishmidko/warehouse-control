/** @file Независимый audit fixture: UUID/коды, без реальных пользователей и чувствительных данных. */
import { randomUUID } from 'node:crypto';
import type { AuditEntryInput } from '@backend/modules/audit/dto/audit-entry.dto';

/** Строит валидный внутренний write input; overrides предназначены для негативных tests. */
export function auditFixture(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    actorType: 'system',
    actorId: randomUUID(),
    action: 'technical.metadata-created',
    entityType: 'technical-metadata',
    entityId: randomUUID(),
    correlationId: randomUUID(),
    reasonCode: 'integration-check',
    changes: { status: { before: 'draft', after: 'posted' } },
    ...overrides,
  };
}
