/** @file Чистый контракт аудита: идентификаторы/коды вместо free-form текста, allowlist безопасных изменений. */
import type { AuditEntryInput, PreparedAuditEntry, SafeAuditChange } from './dto/audit-entry.dto';

import { isUuid } from '../../shared/validation/identifiers';
import { isStockQuantity } from '../../shared/quantities/quantity';
const code = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const statuses = new Set(['draft', 'posted', 'active', 'consumed', 'released']);
const quantityFields = new Set(['quantity', 'onHand', 'reserved']);
const identifierFields = new Set(['warehouseId', 'locationId', 'productId']);

/** Разрешает plain JSON objects, не arrays или host objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Проверяет scalar по смыслу поля; UUID/status не становятся каналом произвольного текста. */
function safeValue(field: string, value: unknown): value is string | number | null {
  if (value === null) return true;
  if (field === 'status') return typeof value === 'string' && statuses.has(value);
  if (quantityFields.has(field)) return isStockQuantity(value);
  return identifierFields.has(field) && isUuid(value);
}

/** Fail closed: неверные обязательные поля отклоняются, небезопасные changes удаляются с redaction flag. */
export function prepareAuditEntry(input: AuditEntryInput): PreparedAuditEntry {
  if (!input || !['user', 'system'].includes(input.actorType)) throw new Error('Invalid audit actorType');
  for (const field of ['actorId', 'entityId', 'correlationId'] as const) {
    if (!isUuid(input[field])) throw new Error(`Invalid audit ${field}`);
  }
  for (const field of ['action', 'entityType', 'reasonCode'] as const) {
    if (typeof input[field] !== 'string' || input[field].length > 96 || !code.test(input[field])) {
      throw new Error(`Invalid audit ${field}`);
    }
  }
  const changes: Record<string, SafeAuditChange> = {};
  let hasRedactedChanges = false;
  if (input.changes !== undefined && !isRecord(input.changes)) throw new Error('Invalid audit changes');
  for (const [field, value] of Object.entries(input.changes ?? {})) {
    if (!(field === 'status' || quantityFields.has(field) || identifierFields.has(field)) || !isRecord(value)) {
      hasRedactedChanges = true;
      continue;
    }
    const change: { before?: string | number | null; after?: string | number | null } = {};
    for (const [side, scalar] of Object.entries(value)) {
      if ((side === 'before' || side === 'after') && safeValue(field, scalar)) change[side] = scalar;
      else hasRedactedChanges = true;
    }
    if (Object.keys(change).length) changes[field] = change;
    else hasRedactedChanges = true;
  }
  return {
    actorType: input.actorType, actorId: input.actorId, action: input.action,
    entityType: input.entityType, entityId: input.entityId, correlationId: input.correlationId,
    reasonCode: input.reasonCode, changes, hasRedactedChanges,
  };
}
