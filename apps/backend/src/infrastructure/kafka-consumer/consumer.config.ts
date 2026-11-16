/** @file Явный opt-in consumer inventory.putaway; настройки не затрагивают API/local worker startup. */
import { kafkaBrokers, kafkaTls } from '../kafka/kafka-connection.config';
import type { ConnectionOptions } from 'node:tls';
/** Stable name/group не задаются случайным Pod ID; zero-offset группа читает историю с начала. */
export interface ConsumerConfig {
  readonly brokers: string[];
  readonly ssl: ConnectionOptions;
  readonly transactionTimeoutMs: number;
  readonly shutdownMs: number;
  readonly healthPort: number;
}
/** Ошибка безопасна для логирования только через статический CONSUMER_STARTUP_FAILED. */
export function validateConsumerEnvironment(env: NodeJS.ProcessEnv): ConsumerConfig {
  if (env.CONSUMER_ENABLED !== 'true' || env.CONSUMER_START !== 'retained-cursor')
    throw new Error('Consumer opt-in required');
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name] ?? String(fallback);
    if (!/^[0-9]+$/.test(raw) || Number(raw) < min || Number(raw) > max)
      throw new Error('Consumer configuration invalid');
    return Number(raw);
  };
  return Object.freeze({
    brokers: kafkaBrokers(env.CONSUMER_BROKERS),
    ssl: kafkaTls(env.CONSUMER_CA_FILE, env.CONSUMER_CERT_FILE, env.CONSUMER_KEY_FILE),
    // Session timeout15s: ограничиваем одну DB operation10s; heartbeat работает отдельно от transaction.
    transactionTimeoutMs: integer('CONSUMER_TRANSACTION_TIMEOUT_MS', 10000, 50, 10000),
    shutdownMs: integer('CONSUMER_SHUTDOWN_MS', 20000, 15000, 60000),
    healthPort: integer('CONSUMER_HEALTH_PORT', 9102, 1, 65535),
  });
}
