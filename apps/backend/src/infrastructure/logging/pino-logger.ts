/** @file Единый Pino adapter: key-value JSON, safe fields и async-local контекст без глобального current request. */
import pino, { type DestinationStream } from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  LOG_EVENTS,
  LOG_MODULES,
  type LogModule,
  safeLogFields,
  type LogFields,
  type LogEvent,
  type OperationalLogger,
} from '../../shared/logging/log-contract';
/** Не допускаем credentials в service/env/module bindings через произвольное значение окружения. */
export interface LoggingIdentity {
  process: 'api' | 'worker' | 'cli';
  environment: 'development' | 'test' | 'production' | 'unknown';
  module: LogModule;
}
/** Factory вызывается владельцем startup; модули получают child, а не создают свой sink. */
export function createOperationalLogger(
  identity: LoggingIdentity,
  destination: DestinationStream,
): OperationalLogger & {
  run<T>(fields: LogFields, work: () => T): T;
  fields(): LogFields;
} {
  if (
    !['api', 'worker', 'cli'].includes(identity.process) ||
    !['development', 'test', 'production', 'unknown'].includes(identity.environment) ||
    !(LOG_MODULES as readonly string[]).includes(identity.module)
  )
    throw new Error('Invalid logging identity');
  const contexts = new AsyncLocalStorage<LogFields>();
  const sink = pino(
    {
      base: {
        service: 'warehouse-backend',
        process: identity.process,
        environment: identity.environment,
      },
      timestamp: false,
      mixin: () => ({ timestamp: new Date().toISOString() }),
      messageKey: 'message',
      formatters: { level: (label) => ({ level: label }) },
      // Defense in depth; allowlist выше не передаёт произвольные объекты в Pino.
      redact: {
        paths: ['password', 'token', 'cookie', 'authorization', 'payload', 'err'],
        remove: true,
      },
    },
    destination,
  );
  const bind = (bound: LogFields): OperationalLogger => ({
    emit(event: LogEvent, fields: LogFields = {}) {
      try {
        const [level, message] = LOG_EVENTS[event];
        const record = safeLogFields({
          ...bound,
          ...contexts.getStore(),
          ...safeLogFields(fields),
        });
        if (level === 'error' && !record.errorCode) record.errorCode = 'OPERATION_FAILED';
        sink[level]({ ...record, event }, message);
      } catch {
        // Ошибка синхронного sink не превращает commit в отказ и не запускает retry эффекта.
        // Повторный вывод в этот sink мог бы рекурсивно повторить ту же ошибку.
      }
    },
    child(fields) {
      return bind({ ...bound, ...safeLogFields(fields) });
    },
  });
  return {
    ...bind({ module: identity.module }),
    fields() {
      return safeLogFields(contexts.getStore() ?? {});
    },
    run<T>(fields: LogFields, work: () => T): T {
      return contexts.run(
        Object.freeze({ ...contexts.getStore(), ...safeLogFields(fields) }),
        work,
      );
    },
  };
}
