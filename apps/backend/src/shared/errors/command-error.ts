/** @file Безопасные коды прикладного отказа; HTTP statuses и тексты остаются в transport adapter. */
/** Разрешённые прикладные отказы HTTP-команд; transport adapter отдельно определяет status/detail. */
export type CommandErrorCode = 'VALIDATION_FAILED' | 'INVALID_CORRELATION_ID' | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'INVALID_IDEMPOTENCY_KEY' | 'DEV_ACTOR_UNAVAILABLE' | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_TOO_LARGE';
/** Не содержит произвольного detail/payload: caller может выбрать только доверенный код. */
export class CommandError extends Error {
  /** Сохраняет только доверенный code; не принимает raw payload, arbitrary detail или SQL cause для публичного ответа. */
  constructor(readonly code: CommandErrorCode) { super(code); this.name = 'CommandError'; }
}
