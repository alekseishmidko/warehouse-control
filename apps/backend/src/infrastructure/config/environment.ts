/** @file Общая для API и CLI загрузка root .env и строгая валидация без раскрытия значений. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { isIP } from 'node:net';

/** Проверенные настройки процесса; databaseUrl чувствителен и не должен попадать в логи. */
export interface RuntimeConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  /** IP для listen; сетевой bind сам не заменяет session authentication и warehouse ACL. */
  readonly httpHost: string;
}

/** Чистая проверка значений; исключения содержат только имена параметров, никогда их значения. */
export function validateEnvironment(env: NodeJS.ProcessEnv): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('Invalid NODE_ENV: expected development, test or production');
  }
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('Invalid PORT: expected integer between 1 and 65535');
  }
  const databaseUrl = env.DATABASE_URL;
  try {
    const url = new URL(databaseUrl ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.pathname.length < 2 ||
      url.hash ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))
    ) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error('Invalid DATABASE_URL: expected PostgreSQL URL with user, host and database');
  }
  // Default bind не открывает локальную учебную среду внешней сети; DNS aliases не принимаем.
  const httpHost = env.HTTP_HOST ?? '127.0.0.1';
  if (!isIP(httpHost)) throw new Error('Invalid HTTP_HOST: expected IP address');
  // Старый opt-in больше не поддержан: ни dev, ни test не должны незаметно обходить auth.
  if (env.DEV_ACTOR_ENABLED !== undefined && env.DEV_ACTOR_ENABLED !== 'false')
    throw new Error('DEV_ACTOR_ENABLED is no longer supported');
  return Object.freeze({
    nodeEnv: nodeEnv as RuntimeConfig['nodeEnv'],
    port: Number(rawPort),
    databaseUrl: databaseUrl!,
    httpHost,
  });
}

/** Загружает optional root .env; переменные процесса имеют приоритет. Не требует файла в production. */
export function loadEnvironment(): RuntimeConfig {
  const envPath = resolve(__dirname, '../../../../../.env');
  if (existsSync(envPath)) {
    try {
      loadEnvFile(envPath);
    } catch {
      throw new Error('Cannot load root .env');
    }
  }
  return validateEnvironment(process.env);
}
