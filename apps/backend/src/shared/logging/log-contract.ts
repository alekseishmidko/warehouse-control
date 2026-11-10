/** @file Контракт операционных логов: фиксированные события и allowlist диагностических полей без I/O. */
import { isUuid } from '../validation/identifiers';
/** Сообщения задаёт код, а не HTTP/event input или текст исключения. */
export const LOG_EVENTS = {
  'database.connection_failed': ['error', 'Database connection failed'],
  'worker.poll_failed': ['error', 'Worker poll failed'],
  'receiving.posted': ['info', 'Receipt posted'],
  'database.checked': ['info', 'Database check passed'],
  'worker.idle': ['warn', 'Worker has no registered handlers'],
  'framework.diagnostic': ['info', 'Framework lifecycle diagnostic'],
  'framework.warning': ['warn', 'Framework lifecycle warning'],
  'framework.failed': ['error', 'Framework lifecycle failed'],
  'http.failed': ['error', 'HTTP response failed'],
  'http.rejected': ['warn', 'HTTP request rejected'],
  'http.aborted': ['warn', 'HTTP response aborted'],
  'transaction.failed': ['error', 'Transaction outcome not confirmed'],
  'http.completed': ['info', 'HTTP response completed'],
  'operation.replayed': ['info', 'Saved operation replayed'],
  'delivery.claimed': ['info', 'Delivery claimed'],
  'delivery.stale': ['warn', 'Delivery claim stale'],
  'api.shutdown_deadline': ['error', 'API shutdown deadline exceeded'],
  'worker.shutdown_deadline': ['error', 'Worker shutdown deadline exceeded'],
  'delivery.persistence_failed': ['error', 'Delivery outcome persistence failed'],
  'telemetry.failed': ['error', 'Telemetry export or SDK failed'],
  'api.failed': ['error', 'Application startup failed'],
  'seed.failed': [
    'error',
    'Dev fixtures failed. Require development mode, database availability and applied migrations.',
  ],
  'api.ready': ['info', 'API ready'],
  'worker.ready': ['info', 'Worker ready'],
  'database.migrated': ['info', 'Database migrations completed'],
  'process.started': ['info', 'Process started'],
  'process.stopped': ['info', 'Process stopped'],
  'process.failed': ['error', 'Process failed'],
  'operation.started': ['info', 'Operation started'],
  'operation.completed': ['info', 'Operation completed'],
  'operation.failed': ['error', 'Operation failed'],
  'transaction.committed': ['info', 'Transaction committed'],
  'transaction.rolled_back': ['warn', 'Transaction rolled back'],
  'delivery.completed': ['info', 'Delivery completed'],
  'delivery.retry': ['warn', 'Delivery scheduled for retry'],
  'delivery.dead': ['error', 'Delivery exhausted attempts'],
} as const;
/** Logger не принимает свободный message или raw exception. */
export type LogEvent = keyof typeof LOG_EVENTS;
/** Технические категории приложения; поле module не принимает произвольный клиентский текст. */
export const LOG_MODULES = [
  'http',
  'worker',
  'transaction',
  'bootstrap',
  'cli',
  'receiving',
  'inventory',
  'fulfillment',
  'identity',
  'outbox',
  'audit',
] as const;
/** Категория child logger без создания нового sink. */
export type LogModule = (typeof LOG_MODULES)[number];
/** Только диагностические scalar fields. Actor, payload, session и токены сюда не входят. */
export interface LogFields {
  module?: LogModule;
  httpStatus?: number;
  destination?: string;
  errorCode?: string;
  code?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  aggregateId?: string;
  attempt?: number;
  durationMs?: number;
}
/** Контракт не зависит от Pino/Nest; конкретный sink остаётся в infrastructure. */
export interface OperationalLogger {
  emit(event: LogEvent, fields?: LogFields): void;
  child(fields: LogFields): OperationalLogger;
}
/** Runtime allowlist защищает также от лишних полей, переданных через структурную типизацию. */
export function safeLogFields(input: LogFields): LogFields {
  const result: LogFields = {};
  if (Number.isInteger(input.httpStatus) && input.httpStatus! >= 100 && input.httpStatus! <= 599)
    result.httpStatus = input.httpStatus;
  if (typeof input.destination === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/.test(input.destination))
    result.destination = input.destination;
  if (
    input.errorCode &&
    [
      'TELEMETRY_FAILED',
      'CONFIG_INVALID',
      'HTTP_FAILED',
      'HTTP_REJECTED',
      'STDOUT_FAILED',
      'ADMIN_DEADLINE_EXCEEDED',
      'ADMIN_COMMAND_FAILED',
      'ADMIN_CLEANUP_FAILED',
      'ADMIN_ENTRYPOINT_FAILED',
      'INVALID_ARGUMENTS',
      'LOCAL_ACCESS_REQUIRED',
      'ADMIN_ROLE_REQUIRED',
      'DELIVERY_NOT_FOUND',
      'DELIVERY_BUSY',
      'LEASE_ACTIVE',
      'NOT_DEAD',
      'PREDECESSOR_REQUIRED',
      'ALREADY_PROCESSED',
      'ATTEMPT_LIMIT_REACHED',
      'OPERATION_FAILED',
      'DATABASE_REJECTED',
      'HANDLER_REJECTED',
      'HANDLER_MISSING',
      'CURSOR_MISMATCH',
      'IDENTITY_MISMATCH',
      'INVALID_JSON',
      'INVALID_EVENT',
      'UNSUPPORTED_EVENT',
      'MESSAGE_TOO_LARGE',
      'TRANSIENT_FAILURE',
      'ATTEMPTS_EXHAUSTED',
      'REDACTED',
    ].includes(input.errorCode)
  )
    result.errorCode = input.errorCode;
  if (input.code && input.code === result.errorCode) result.code = input.code;
  if (input.module && (LOG_MODULES as readonly string[]).includes(input.module))
    result.module = input.module;
  for (const key of ['correlationId', 'eventId', 'aggregateId'] as const) {
    const value = input[key];
    if (typeof value === 'string' && isUuid(value)) result[key] = value.toLowerCase();
  }
  for (const [key, size] of [
    ['traceId', 32],
    ['spanId', 16],
  ] as const) {
    const value = input[key];
    if (
      typeof value === 'string' &&
      value.length === size &&
      /^[a-f0-9]+$/.test(value) &&
      !/^0+$/.test(value)
    )
      result[key] = value;
  }
  if (Number.isSafeInteger(input.attempt) && input.attempt! >= 1) result.attempt = input.attempt;
  if (
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
  )
    result.durationMs = input.durationMs;
  return result;
}
