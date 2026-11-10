/** @file Unit suite конфигурации: strict validation, defaults и безопасный реальный startup без Docker. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  loadRootEnvironment,
  loadEnvironment,
  validateEnvironment,
} from '@backend/infrastructure/config/environment';

const valid = { DATABASE_URL: 'postgresql://user:private-password@localhost:15432/warehouse' };

describe('runtime configuration', () => {
  test('optional env file preserves process precedence, reports safe file errors and validates after load', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'wms401-env-'));
    const saved = { ...process.env };
    try {
      const file = resolve(dir, '.env');
      delete process.env.WMS401_ENV_FILE_TEST;
      process.env.DATABASE_URL = valid.DATABASE_URL;
      process.env.NODE_ENV = 'test';
      process.env.PORT = '4321';
      process.env.HTTP_HOST = '127.0.0.1';
      delete process.env.DEV_ACTOR_ENABLED;
      // Parent проверяет ветки loader на пустом файле: native env не должен протечь между Jest suites.
      writeFileSync(file, '');
      loadRootEnvironment(resolve(dir, 'missing'));
      expect(process.env.WMS401_ENV_FILE_TEST).toBeUndefined();
      expect(loadEnvironment(file).port).toBe(4321);
      // Node.loadEnvFile изменяет native env, Jest использует изолированную копию process.env.
      // Проверяем фактическую загрузку в настоящем Node executable, а не подменяем loader mock.
      writeFileSync(file, 'WMS401_ENV_FILE_TEST=loaded\nPORT=9999\n');
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          "const e=require('./dist/infrastructure/config/environment');const c=e.loadEnvironment(process.argv[1]);process.stdout.write(JSON.stringify({port:c.port,loaded:process.env.WMS401_ENV_FILE_TEST}))",
          file,
        ],
        { env: { ...process.env }, encoding: 'utf8' },
      );
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ port: 4321, loaded: 'loaded' });
      expect(() => loadRootEnvironment(dir)).toThrow('Cannot load root .env');
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('defaults and validated explicit settings', () => {
    const config = validateEnvironment(valid);
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(Object.isFrozen(config)).toBe(true);
    expect(validateEnvironment({ ...valid, PORT: '4000', NODE_ENV: 'test' }).port).toBe(4000);
    expect(validateEnvironment({ ...valid, NODE_ENV: 'production' }).nodeEnv).toBe('production');
  });

  test.each(['', '0', '-1', '65536', '3.5', '3000junk', ' 3000', '1e3'])(
    'rejects PORT %j',
    (PORT) => {
      expect(() => validateEnvironment({ ...valid, PORT })).toThrow('Invalid PORT');
    },
  );

  test('accepts upper port boundary', () => {
    expect(validateEnvironment({ ...valid, PORT: '65535' }).port).toBe(65535);
  });

  test.each(['', 'prod', 'staging'])('rejects NODE_ENV %j', (NODE_ENV) => {
    expect(() => validateEnvironment({ ...valid, NODE_ENV })).toThrow('Invalid NODE_ENV');
  });

  test.each([
    undefined,
    '',
    'not-a-url',
    'http://user:secret@localhost/db',
    'postgresql://localhost/db',
    'postgresql://user@localhost/',
    'postgresql://user@localhost:99999/db',
    'postgresql://user@localhost/db#secret',
  ])('rejects DATABASE_URL %j', (DATABASE_URL) => {
    expect(() => validateEnvironment({ DATABASE_URL })).toThrow('Invalid DATABASE_URL');
  });

  test('accepts postgres protocol', () => {
    expect(validateEnvironment({ DATABASE_URL: 'postgres://user@localhost/db' }).port).toBe(3000);
  });

  test('does not reveal invalid values in errors', () => {
    for (const env of [
      { DATABASE_URL: 'http://user:private-password@localhost/db' },
      { ...valid, PORT: 'private-password' },
      { ...valid, NODE_ENV: 'private-password' },
    ]) {
      let caught: unknown;
      try {
        validateEnvironment(env);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).not.toContain('private-password');
    }
  });

  test('entrypoint fails before bind without revealing credentials', () => {
    const result = spawnSync(process.execPath, [resolve('dist/main.js')], {
      env: { ...process.env, DATABASE_URL: 'http://user:private-password@localhost/db' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Application startup failed');
    expect(result.stdout + result.stderr).not.toContain('private-password');
  });
});
