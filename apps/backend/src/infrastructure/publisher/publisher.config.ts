/** @file Publisher-only config: explicit full-replay opt-in, stable fencing ID и mTLS без логирования secrets. */
import { PUBLISHER_CONFIG_ERROR_CODES as CONFIG_CODES } from '../../shared/logging/log-contract';
import { kafkaBrokers, kafkaTls } from '../kafka/kafka-connection.config';
import type { ConnectionOptions } from 'node:tls';
/** Неизменная конфигурация одного логического publisher, не одного Pod. */
export interface PublisherConfig {
  readonly brokers: string[];
  readonly transactionalId: string;
  readonly ssl: ConnectionOptions;
  readonly requestTimeoutMs: number;
  readonly pollMs: number;
  readonly shutdownMs: number;
  readonly healthPort: number;
}
/** Только trusted typed error может передать свой code в CLI. Raw TLS/driver errors остаются скрыты. */
export class PublisherConfigurationError extends Error {
  constructor(readonly errorCode: (typeof CONFIG_CODES)[keyof typeof CONFIG_CODES]) {
    super('Publisher configuration invalid');
    this.name = 'PublisherConfigurationError';
  }
}
/** Ошибки содержат только имя поля; исходные URLs/PEM не печатаются. Plaintext transport запрещён. */
export function validatePublisherEnvironment(env: NodeJS.ProcessEnv): PublisherConfig {
  // Старый API/worker не требует этих настроек. Только отдельный publisher должен
  // получить явное разрешение на from-start replay: незаметно включать его при app startup нельзя.
  if (env.PUBLISHER_ENABLED !== 'true' || env.PUBLISHER_REPLAY !== 'from-start')
    throw new PublisherConfigurationError(CONFIG_CODES.optIn);
  let brokers: string[];
  try {
    brokers = kafkaBrokers(env.PUBLISHER_BROKERS);
  } catch {
    throw new PublisherConfigurationError(CONFIG_CODES.brokers);
  }
  const transactionalId = env.PUBLISHER_TRANSACTIONAL_ID;
  if (!transactionalId || !/^[a-z][a-z0-9._-]{2,95}$/.test(transactionalId))
    throw new PublisherConfigurationError(CONFIG_CODES.transactionalId);
  let ssl: ConnectionOptions;
  try {
    ssl = kafkaTls(env.PUBLISHER_CA_FILE, env.PUBLISHER_CERT_FILE, env.PUBLISHER_KEY_FILE);
  } catch {
    throw new PublisherConfigurationError(CONFIG_CODES.tls);
  }
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
    code: (typeof CONFIG_CODES)[keyof typeof CONFIG_CODES],
  ): number => {
    const value = env[name] ?? String(fallback);
    if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new PublisherConfigurationError(code);
    return Number(value);
  };
  return Object.freeze({
    brokers,
    transactionalId,
    ssl,
    requestTimeoutMs: integer(
      'PUBLISHER_REQUEST_TIMEOUT_MS',
      5000,
      500,
      10000,
      CONFIG_CODES.requestTimeout,
    ),
    pollMs: integer('PUBLISHER_POLL_MS', 1000, 10, 60000, CONFIG_CODES.poll),
    shutdownMs: integer('PUBLISHER_SHUTDOWN_MS', 45000, 35000, 120000, CONFIG_CODES.shutdown),
    healthPort: integer('PUBLISHER_HEALTH_PORT', 9101, 1, 65535, CONFIG_CODES.healthPort),
  });
}
