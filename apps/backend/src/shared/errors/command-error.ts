/** @file Безопасные коды прикладного отказа; HTTP statuses и тексты остаются в transport adapter. */
/** Разрешённые прикладные отказы HTTP-команд; transport adapter отдельно определяет status/detail. */
export type CommandErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CORRELATION_ID'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'DEV_ACTOR_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_TOO_LARGE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CSRF_REJECTED'
  | 'TOO_MANY_REQUESTS'
  | 'SERVICE_UNAVAILABLE'
  | 'USER_NOT_FOUND'
  | 'LAST_ADMIN_REQUIRED'
  | 'RECEIPT_NOT_FOUND'
  | 'RECEIPT_ALREADY_POSTED'
  | 'INVALID_RECEIPT'
  | 'PRODUCT_NOT_FOUND'
  | 'LOCATION_NOT_FOUND'
  | 'INVALID_RECEIVING_LOCATION'
  | 'STOCK_LIMIT_EXCEEDED';
/** Не содержит произвольного detail/payload: caller может выбрать только доверенный код. */
export class CommandError extends Error {
  /** Сохраняет только доверенный code; не принимает raw payload, arbitrary detail или SQL cause для публичного ответа. */
  constructor(readonly code: CommandErrorCode) {
    // Сохраняем привычные сообщения внутренних справочников; HTTP mapper читает только code.
    const messages: Partial<Record<CommandErrorCode, string>> = {
      PRODUCT_NOT_FOUND: 'Product not found',
      LOCATION_NOT_FOUND: 'Location does not belong to warehouse',
      INVALID_RECEIVING_LOCATION: 'Receipt requires receiving location',
      STOCK_LIMIT_EXCEEDED: 'Stock quantity limit exceeded',
    };
    super(messages[code] ?? code);
    this.name = 'CommandError';
  }
}
