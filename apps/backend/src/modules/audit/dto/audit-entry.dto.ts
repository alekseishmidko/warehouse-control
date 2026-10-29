/** @file Внутренние DTO аудита: вход сервиса и безопасные данные repository, без HTTP-декораторов. */
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';

/** Внутренний write input, не HTTP DTO. actor берётся из доверенного application context. */
export interface AuditEntryInput extends OperationMetadata {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly changes?: Readonly<Record<string, unknown>>;
}

/** Допустимое изменение: разрешённый scalar before/after; произвольные вложенные payload запрещены. */
export interface SafeAuditChange {
  readonly before?: string | number | boolean | null;
  readonly after?: string | number | boolean | null;
}

/** Проверенная запись для хранения; id и occurredAt генерируются PostgreSQL. */
export interface PreparedAuditEntry extends Omit<AuditEntryInput, 'changes'> {
  readonly changes: Record<string, SafeAuditChange>;
  readonly hasRedactedChanges: boolean;
}
