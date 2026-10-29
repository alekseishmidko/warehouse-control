/** @file Чистая общая диагностика worker и inspect: разрешённые поля и безопасные коды ошибок.
 * Нет I/O, зависимостей от Nest/БД и сериализации payload или токена владения доставкой. */
import { isUuid } from '../validation/identifiers';
/** Единый список кодов для хранения и вывода; произвольный текст исключения не становится диагностическим кодом. */
export const DELIVERY_ERROR_CODES = [
  'HANDLER_REJECTED',
  'HANDLER_MISSING',
  'CURSOR_MISMATCH',
  'IDENTITY_MISMATCH',
  'INVALID_JSON',
  'INVALID_EVENT',
  'UNSUPPORTED_EVENT',
  'MESSAGE_TOO_LARGE',
  'DATABASE_REJECTED',
  'TRANSIENT_FAILURE',
  'ATTEMPTS_EXHAUSTED',
] as const;
/** Принимает недоверенное значение из БД или обработчика. Возвращает известный код, null
 * при отсутствии ошибки либо REDACTED для любого другого значения; исключений и побочных эффектов нет. */
export function safeDeliveryError(value: unknown): string | null {
  return value == null
    ? null
    : typeof value === 'string' && (DELIVERY_ERROR_CODES as readonly string[]).includes(value)
      ? value
      : 'REDACTED';
}
/** Общий набор key-value полей для локальных логов и CLI. attempt — общий счётчик,
 * а не номер в обновлённом бюджете; correlationId=null при некорректном значении в envelope. */
export interface DeliveryDiagnostic {
  readonly eventId: string;
  readonly correlationId: string | null;
  readonly stream: {
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly version: number;
  };
  readonly consumer: string;
  readonly attempt: number;
  readonly lastError: string | null;
}
/**
 * Создаёт новый диагностический объект из серверных столбцов идентичности и недоверенных correlation/error.
 * @param input Идентичность доставки из БД; correlationId и lastError требуют фильтрации.
 * @returns Только явно выбранные поля: UUID корреляции нормализован, неизвестная ошибка замаскирована.
 * Токен владения и payload не входят в контракт; дополнительные свойства объекта не копируются.
 */
export function deliveryDiagnostic(input: {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  destination: string;
  attempt: number;
  correlationId?: unknown;
  lastError?: unknown;
}): DeliveryDiagnostic {
  return {
    eventId: input.eventId,
    correlationId: isUuid(input.correlationId) ? input.correlationId.toLowerCase() : null,
    stream: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      version: input.version,
    },
    consumer: input.destination,
    attempt: input.attempt,
    lastError: safeDeliveryError(input.lastError),
  };
}
