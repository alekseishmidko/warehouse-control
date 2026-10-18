/** @file Внутренние DTO аудита: вход сервиса и безопасные данные repository, без HTTP-декораторов. */
/** Внутренний write input, не HTTP DTO. actor берётся из доверенного application context. */
export interface AuditEntryInput {
  readonly actorType: 'user' | 'system';
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly correlationId: string;
  /** Зарегистрированный код основания, не пользовательский комментарий и не произвольный payload. */
  readonly reasonCode: string;
  readonly changes?: Readonly<Record<string, unknown>>;
}

/** Допустимое изменение: разрешённый scalar before/after; произвольные вложенные payload запрещены. */
export interface SafeAuditChange {
  readonly before?: string | number | null;
  readonly after?: string | number | null;
}

/** Проверенная запись для хранения; id и occurredAt генерируются PostgreSQL. */
export interface PreparedAuditEntry extends Omit<AuditEntryInput, 'changes'> {
  readonly changes: Record<string, SafeAuditChange>;
  readonly hasRedactedChanges: boolean;
}

