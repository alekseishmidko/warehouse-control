/**
 * @file Regression R-02: Compose --wait не принимает socket-only initdb server за готовый PostgreSQL.
 * Запускает настоящий base Compose с новым UUID project/volume и управляемым initdb barrier.
 * Credentials идут через временный env-file0600. finally удаляет только ресурсы этого теста.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

/** Наблюдает Docker state до условия; sleep только ограничивает частоту чтения, не доказывает готовность. */
async function observe(read, accepts) {
  const deadline = Date.now() + 30000;
  do {
    const value = read();
    if (accepts(value)) return value;
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
  throw new Error('PostgreSQL readiness observation timed out');
}

/** Ограничивает ожидание принадлежащего тесту Compose child; timer всегда освобождается. */
async function completion(result) {
  let timer;
  try {
    return await Promise.race([
      result,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Compose completion timed out')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test(
  'Compose waits for TCP after initdb and never reports socket-only server healthy',
  { timeout: 120000 },
  async () => {
    const root = resolve(__dirname, '..');
    const temp = mkdtempSync(join(tmpdir(), 'wms-readiness-'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(POSTGRES_|COMPOSE_)/.test(key)),
    );
    const envFile = join(temp, 'gate.env');
    const init = join(temp, 'hold-initdb.sh');
    const overlay = join(temp, 'overlay.yaml');
    const project = 'wms-readiness-' + randomUUID();
    writeFileSync(
      envFile,
      `POSTGRES_USER=warehouse\nPOSTGRES_DB=warehouse\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nPOSTGRES_PORT=0\n`,
      { mode: 0o600 },
    );
    // Executable shebang нужен и на Docker Desktop bind mount. Barrier не меняет бизнес-schema.
    writeFileSync(
      init,
      '#!/bin/sh\nset -eu\ntouch /tmp/wms-init-held\ni=0\nwhile [ ! -f /tmp/wms-init-release ]; do\n  i=$((i+1))\n  [ "$i" -lt 600 ] || exit 1\n  sleep 0.1\ndone\n',
      { mode: 0o755 },
    );
    // JSON — допустимый YAML. Override добавляет только test init script; image/health timings берутся из production source.
    writeFileSync(
      overlay,
      JSON.stringify({
        services: {
          postgres: {
            volumes: [
              {
                type: 'bind',
                source: init,
                target: '/docker-entrypoint-initdb.d/001-readiness.sh',
                read_only: true,
              },
            ],
          },
        },
      }),
    );
    const common = [
      'compose',
      '--project-name',
      project,
      '--env-file',
      envFile,
      '-f',
      join(root, 'infra/compose/compose.yaml'),
      '-f',
      overlay,
    ];
    /** Выполняет только доверенные argv. Ошибка не печатает env/config или raw driver output. */
    const docker = (args, allowFailure = false) => {
      try {
        return {
          status: 0,
          output: execFileSync('docker', args, {
            cwd: root,
            env,
            encoding: 'utf8',
            timeout: 60000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim(),
        };
      } catch (error) {
        if (allowFailure && typeof error.status === 'number')
          return { status: error.status, output: '' };
        throw new Error('Docker readiness command failed: ' + args[0]);
      }
    };
    let up, result, container;
    try {
      up = spawn('docker', [...common, 'up', '-d', '--wait', '--wait-timeout', '60', 'postgres'], {
        cwd: root,
        env,
        stdio: 'ignore',
      });
      // Подписываемся сразу, чтобы ранняя ошибка spawn не стала unhandled event/rejection.
      result = new Promise((done) => {
        up.once('error', () => done(-1));
        up.once('close', (code) => done(code));
      });
      container = await observe(
        () => docker([...common, 'ps', '-a', '-q', 'postgres']).output,
        Boolean,
      );
      await observe(
        () => docker(['exec', container, 'test', '-f', '/tmp/wms-init-held'], true).status,
        (status) => status === 0,
      );
      assert.equal(
        docker(['exec', container, 'pg_isready', '-U', 'warehouse', '-d', 'warehouse']).status,
        0,
      );
      assert.notEqual(
        docker(
          [
            'exec',
            container,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'warehouse',
            '-d',
            'warehouse',
          ],
          true,
        ).status,
        0,
      );
      const health = () =>
        JSON.parse(docker(['inspect', '--format', '{{json .State.Health}}', container]).output);
      const previous = health().Log?.at(-1)?.End;
      // Требуем новый настоящий health probe во время barrier, а не снимок до initdb.
      const held = await observe(health, (state) => state.Log?.at(-1)?.End !== previous);
      assert.notEqual(held.Status, 'healthy', 'socket-only initdb server must not be healthy');
      assert.notEqual(
        held.Log.at(-1).ExitCode,
        0,
        'health probe must refuse TCP before main server',
      );
      assert.equal(up.exitCode, null, 'Compose --wait must remain pending during initdb');
      docker(['exec', container, 'touch', '/tmp/wms-init-release']);
      assert.equal(await completion(result), 0);
      assert.equal(health().Status, 'healthy');
      assert.equal(
        docker([
          'exec',
          container,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'warehouse',
          '-d',
          'warehouse',
        ]).status,
        0,
      );
    } finally {
      // Сначала останавливаем только свой CLI, затем удаляем только свой UUID project/volume.
      try {
        if (up?.pid && up.exitCode === null) up.kill('SIGTERM');
        if (result) await completion(result);
      } finally {
        try {
          docker([...common, 'down', '--volumes', '--remove-orphans']);
        } finally {
          rmSync(temp, { recursive: true, force: true });
        }
      }
    }
  },
);
