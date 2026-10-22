/** @file Доверенный scope команды; actor/operation берутся сервером, key и correlationId валидируются HTTP adapter. */
/** Immutable scalar context отдельной команды; не является HTTP body DTO и не содержит DB client. */
export interface CommandScope {
  /** Тип субъекта участвует в scope, чтобы UUID user и system не делили один idempotency result. */
  readonly actorType: 'user' | 'system';
  /** Server-side actor UUID после проверки identity, не клиентское поле body. */
  readonly actorId: string;
  /** Постоянное имя команды из server metadata; разные operations не делят результат одного key. */
  readonly operation: string;
  /** UUID Idempotency-Key, один для всех повторов конкретной команды. */
  readonly key: string;
  /** ID текущей попытки для диагностики; не включается в hash и не определяет replay identity. */
  readonly correlationId: string;
}
/** JSON success snapshot; response headers ограничены Location, credentials/cookies не сохраняются. */
export interface CommandResult {
  /** Только поддержанные success responses; ошибки откатываются и не сохраняются этим контрактом. */
  readonly statusCode: 200 | 201 | 202;
  /** Доверенный JSON result без секретов; runtime service проверяет serializability и копирует данные. */
  readonly body: unknown;
  /** Allowlist replay headers: только относительный Location, без cookies/auth/correlation headers. */
  readonly headers?: { readonly location?: string };
}
