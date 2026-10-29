/** @file Retry policy локального DB handler: allowlisted codes и bounded equal jitter без error payload. */
import { EventContractError } from '../../shared/events/event-contract.error';
import type { WorkerConfig } from './worker.config';
/** Контролируемые permanent отказы обработчика/протокола; raw message не хранится. */
export type PermanentDeliveryCode =
  'HANDLER_REJECTED' | 'HANDLER_MISSING' | 'CURSOR_MISMATCH' | 'IDENTITY_MISMATCH';
/** Явный бизнес/protocol отказ без произвольного detail; схема имеет отдельный EventContractError. */
export class PermanentDeliveryError extends Error {
  /** Принимает только статический код; исключение должно дойти до rollback владельца обработки. */
  constructor(readonly code: PermanentDeliveryCode) {
    super(code);
  }
}
/** Потерянный/истёкший token — управление конкурентным доступом, не ошибка бизнес-обработчика. */
export class StaleDeliveryError extends Error {}
/** Классифицирует SQLSTATE по cause (max 6), без анализа/сохранения произвольного message. */
export function classifyDeliveryError(error: unknown): { permanent: boolean; code: string } {
  // TypeScript readonly/union не защищают runtime от ошибочного JS handler.
  // В БД попадает только allowlist, даже если исключение было создано/изменено вручную.
  if (error instanceof PermanentDeliveryError)
    return {
      permanent: true,
      code: [
        'HANDLER_REJECTED',
        'HANDLER_MISSING',
        'CURSOR_MISMATCH',
        'IDENTITY_MISMATCH',
      ].includes(error.code)
        ? error.code
        : 'HANDLER_REJECTED',
    };
  if (error instanceof EventContractError)
    return {
      permanent: true,
      code: ['INVALID_JSON', 'INVALID_EVENT', 'UNSUPPORTED_EVENT', 'MESSAGE_TOO_LARGE'].includes(
        error.code,
      )
        ? error.code
        : 'INVALID_EVENT',
    };
  let current = error;
  for (let i = 0; i < 6 && current && typeof current === 'object'; i++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    // Data/constraint/SQL/permission errors не исправятся от немедленного повторения.
    if (typeof candidate.code === 'string' && /^(22|23|42)[A-Z0-9]{3}$/.test(candidate.code))
      return { permanent: true, code: 'DATABASE_REJECTED' };
    current = candidate.cause;
  }
  // Deadlock/serialization/disconnect/timeouts и неизвестные ошибки повторяются
  // ограниченно. Это retry доставки целиком, а не скрытый retry внутри runner.
  return { permanent: false, code: 'TRANSIENT_FAILURE' };
}
/** Equal jitter: [cap/2,cap], cap=min(max,base*2^(attempt-1)); random аргумент делает bounds проверяемыми. */
export function retryDelayMs(
  attempt: number,
  config: WorkerConfig,
  random = Math.random(),
): number {
  const cap = Math.min(
    config.retryMaxMs,
    config.retryBaseMs * 2 ** Math.min(Math.max(attempt - 1, 0), 52),
  );
  return Math.max(1, Math.floor(cap / 2 + (Math.min(1, Math.max(0, random)) * cap) / 2));
}
