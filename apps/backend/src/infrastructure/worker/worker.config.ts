/** @file Worker-only runtime config: bounded polling/lease/retry без раскрытия исходных env values. */
import { loadEnvironment } from '../config/environment';
/** DI token конфигурации; tests заменяют provider, не process.env. */
export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
/** Milliseconds, bounded concurrency=batchSize; clock lease всегда PostgreSQL, не local time. */
export interface WorkerConfig {
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly maxAttempts: number;
  readonly transactionTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}
/** Проверяет worker env без I/O. Ошибка содержит имя настройки, но не её значение. */
export function validateWorkerEnvironment(env: NodeJS.ProcessEnv): WorkerConfig {
  /** Конфигурационные числа — только decimal integer, без coercion пустых строк/Infinity. */
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const value = env[key] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new Error(`Invalid ${key}`);
    return Number(value);
  };
  const config = {
    batchSize: integer('WORKER_BATCH_SIZE', 4, 1, 4),
    pollIntervalMs: integer('WORKER_POLL_INTERVAL_MS', 1000, 10, 60000),
    leaseMs: integer('WORKER_LEASE_MS', 30000, 100, 300000),
    retryBaseMs: integer('WORKER_RETRY_BASE_MS', 1000, 1, 60000),
    retryMaxMs: integer('WORKER_RETRY_MAX_MS', 60000, 1, 3600000),
    maxAttempts: integer('WORKER_MAX_ATTEMPTS', 10, 1, 1000),
    transactionTimeoutMs: integer('WORKER_TRANSACTION_TIMEOUT_MS', 10000, 50, 300000),
    shutdownTimeoutMs: integer('WORKER_SHUTDOWN_TIMEOUT_MS', 15000, 100, 300000),
  };
  if (config.retryBaseMs > config.retryMaxMs) throw new Error('Invalid WORKER_RETRY_MAX_MS');
  if (config.transactionTimeoutMs >= config.leaseMs)
    throw new Error('Invalid WORKER_LEASE_MS: must exceed transaction timeout');
  if (config.shutdownTimeoutMs <= config.transactionTimeoutMs)
    throw new Error('Invalid WORKER_SHUTDOWN_TIMEOUT_MS');
  return Object.freeze(config);
}
/** Загружает общую root .env перед worker settings; API config не расширяется worker-only параметрами. */
export function loadWorkerConfig(): WorkerConfig {
  loadEnvironment();
  return validateWorkerEnvironment(process.env);
}
