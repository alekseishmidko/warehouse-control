/** @file Process owner Pino: единый sink, bounded-context поля, Nest adapter без raw framework messages. */
import { observeLogEvent, startMetrics } from '../metrics/runtime-metrics';
import type { LoggerService } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import pino from 'pino';
import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createOperationalLogger, type LoggingIdentity } from './pino-logger';
import { safeLogFields, type LogEvent, type LogFields } from '../../shared/logging/log-contract';
const buffers = new AsyncLocalStorage<{ event: LogEvent; fields: LogFields }[]>();
let closeTransport: (() => Promise<void>) | undefined;
const ignoreStreamError = () => {};
let enabled = false;
let logger = createOperationalLogger(
  { process: 'cli', environment: 'test', module: 'bootstrap' },
  { write() {} },
);
/** Вызывается startup один раз; pretty явно запрещён при collector/production/non-TTY. */
export function configureLogging(
  identity: LoggingIdentity,
  destination?: { write(value: string): void },
): void {
  if (process.env.LOG_FORMAT && !['json', 'pretty'].includes(process.env.LOG_FORMAT))
    throw new Error('Invalid log format');
  const pretty = process.env.LOG_FORMAT === 'pretty';
  if (
    pretty &&
    (identity.environment !== 'development' ||
      process.env.LOG_COLLECTOR_ENABLED === 'true' ||
      !process.stderr.isTTY)
  )
    throw new Error('Pretty logging requires local interactive development');
  const transport =
    !destination && pretty
      ? pino.transport({ target: 'pino-pretty', options: { destination: 2 } })
      : undefined;
  transport?.on('error', () => {});
  closeTransport = transport
    ? () =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          transport.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
          transport.end();
        })
    : undefined;
  const sink = destination ?? transport ?? process.stderr;
  if (sink instanceof EventEmitter && !sink.listeners('error').includes(ignoreStreamError))
    sink.on('error', ignoreStreamError);
  logger = createOperationalLogger(identity, sink);
  enabled = true;
  startMetrics(identity.process);
}
/** Контекст устанавливается один раз на HTTP/command/handler boundary. */
export function logScope<T>(fields: LogFields, work: () => T): T {
  return logger.run(fields, work);
}
/** Нет произвольного text/Error: события и сообщения определяются общим контрактом. */
export function logEvent(event: LogEvent, fields: LogFields = {}): void {
  if (!enabled) return;
  const span = trace.getActiveSpan()?.spanContext();
  const selected = {
    ...logger.fields(),
    ...(span ? { traceId: span.traceId, spanId: span.spanId } : {}),
    ...safeLogFields(fields),
  };
  const active = trace.getActiveSpan();
  if (selected.correlationId) active?.setAttribute('wms.correlation_id', selected.correlationId);
  if (selected.eventId) active?.setAttribute('wms.event_id', selected.eventId);
  if (selected.aggregateId) active?.setAttribute('wms.aggregate_id', selected.aggregateId);
  if (selected.destination) active?.setAttribute('wms.destination', selected.destination);
  if (selected.attempt) active?.setAttribute('wms.attempt', selected.attempt);
  const queue = buffers.getStore();
  if (queue) queue.push({ event, fields: selected });
  else {
    observeLogEvent(event, selected);
    logger.emit(event, selected);
  }
}
/** Nest lifecycle logs не раскрывают произвольный message/optionalParams/stack. */
export const nestLogger: LoggerService = {
  log() {
    logEvent('framework.diagnostic');
  },
  warn() {
    logEvent('framework.warning');
  },
  error() {
    logEvent('framework.failed');
  },
  debug() {},
  verbose() {},
  fatal() {
    logEvent('framework.failed');
  },
};

/** I/O откладывается до завершения db.transaction promise, включая COMMIT/deferred constraints.
 * При rollback отбрасываем записи, которые могли преждевременно заявить success. */
export async function bufferedTransaction<T>(work: () => Promise<T>): Promise<T> {
  const queue: { event: LogEvent; fields: LogFields }[] = [];
  const started = performance.now();
  const result = await buffers.run(queue, work);
  for (const item of queue) {
    observeLogEvent(item.event, item.fields);
    logger.emit(item.event, { durationMs: performance.now() - started, ...item.fields });
  }
  return result;
}

/** Совместимый CLI code alias и общий errorCode; raw Error никогда не принимается. */
export function logCliFailure(code: string): void {
  logEvent('process.failed', { module: 'cli', errorCode: code, code });
}

/** Владелец процесса вызывает после остановки приложения и exporter; тесты выключают общий test sink. */
export async function stopLogging(): Promise<void> {
  logEvent('process.stopped');
  await closeTransport?.();
  enabled = false;
}
