/** @file Preload до Nest/app imports: безопасные настройки, Pino и ручной OTel SDK без автоматического SQL/URL сбора. */
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRootEnvironment } from '../config/environment';
import { configureLogging, logEvent, stopLogging } from './runtime-logger';
import { createOperationalLogger } from './pino-logger';
import { startTelemetry, stopTelemetry } from './telemetry';
const dist = resolve(__dirname, '../..');
const roles = new Map<string, 'api' | 'worker' | 'cli'>([
  [resolve(dist, 'main.js'), 'api'],
  [resolve(dist, 'worker.js'), 'worker'],
  ...[
    'infrastructure/database/migrate.js',
    'infrastructure/database/check.js',
    'infrastructure/database/seed-dev.js',
    'infrastructure/outbox/outbox-admin.js',
    'modules/identity/bootstrap.js',
  ].map((file): [string, 'cli'] => [resolve(dist, file), 'cli']),
]);
const role = roles.get(require.main?.filename ?? '');
// Импорт application libraries не меняет global SDK и не читает рабочую .env.
if (role) {
  try {
    loadRootEnvironment();
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production')
      throw new Error('Invalid runtime environment');
    configureLogging({ process: role, environment: nodeEnv, module: 'bootstrap' });
    startTelemetry(role, nodeEnv);
    logEvent('process.started');
    process.stdout.on('error', () => {
      logEvent('process.failed', { errorCode: 'STDOUT_FAILED' });
      process.exitCode = 1;
    });
    process.once('beforeExit', () => {
      const deadline = setTimeout(() => {
        logEvent('process.failed');
        process.exit(1);
      }, 3000);
      stopTelemetry()
        .catch(() => {
          logEvent('process.failed');
          process.exitCode = 1;
        })
        .then(() => stopLogging())
        .catch(() => {
          process.exitCode = 1;
        })
        .finally(() => clearTimeout(deadline));
    });
  } catch {
    // Fallback не читает повреждённую конфигурацию и не использует pretty/transport или raw Error.
    try {
      createOperationalLogger(
        { process: role, environment: 'unknown', module: 'bootstrap' },
        {
          write(line: string) {
            writeSync(2, line);
          },
        },
      ).emit('process.failed', { errorCode: 'CONFIG_INVALID' });
    } catch {
      /* stdout/stderr могут быть закрыты. */
    }
    process.exit(1);
  }
}
