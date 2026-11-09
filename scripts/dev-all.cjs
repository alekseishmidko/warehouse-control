/** @file Локальный dev supervisor: PostgreSQL/migrate, один TS compiler, API/worker и Vite; без изменения .env или данных seed. */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');
const root = path.resolve(__dirname, '..');

/** Проверяет только ограничения локального запуска до Docker/build. Полные runtime validators вызываются после сборки. */
function readDevConfiguration(fileEnv, processEnv = {}) {
  const env = { ...fileEnv, ...processEnv };
  env.NODE_ENV ??= 'development';
  if (env.NODE_ENV !== 'development') throw new Error('dev:all требует NODE_ENV=development');
  let database, web;
  try {
    database = new URL(env.DATABASE_URL);
    web = new URL(env.AUTH_ORIGIN);
  } catch {
    throw new Error('Заполните DATABASE_URL и AUTH_ORIGIN в root .env');
  }
  if (!['127.0.0.1', 'localhost'].includes(database.hostname))
    throw new Error('dev:all допускает только локальную Compose БД');
  if (
    web.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(web.hostname) ||
    web.origin !== env.AUTH_ORIGIN
  )
    throw new Error(
      'AUTH_ORIGIN для dev:all должен быть локальным HTTP origin, например http://127.0.0.1:5173',
    );
  const port = (value, name) => {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error('Неверный порт: ' + name);
    return Number(value);
  };
  const apiPort = port(env.PORT ?? '3000', 'PORT');
  const webPort = port(web.port || '80', 'AUTH_ORIGIN');
  const dbPort = port(env.POSTGRES_PORT ?? '15432', 'POSTGRES_PORT');
  const apiHost = env.HTTP_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(apiHost))
    throw new Error('dev:all требует loopback HTTP_HOST');
  if (new Set([apiPort, webPort, dbPort]).size !== 3)
    throw new Error(
      'Порты API, web и PostgreSQL должны различаться; для web обычно AUTH_ORIGIN=http://127.0.0.1:5173',
    );
  if (
    Number(database.port || '5432') !== dbPort ||
    decodeURIComponent(database.username) !== (env.POSTGRES_USER ?? 'warehouse') ||
    decodeURIComponent(database.password) !== env.POSTGRES_PASSWORD ||
    database.pathname.slice(1) !== (env.POSTGRES_DB ?? 'warehouse')
  )
    throw new Error('DATABASE_URL должен соответствовать локальным POSTGRES_*');
  return {
    env,
    apiHost,
    apiPort,
    webPort,
    webHost: web.hostname.replace(/^\[|\]$/g, ''),
    webUrl: web.origin,
    apiUrl: `http://${apiHost === '::1' ? '[::1]' : apiHost}:${apiPort}`,
  };
}

/** Короткая проверка bind; занятый порт не даёт права завершать чужой процесс. Резервирование порта не обещается. */
async function assertPortAvailable(host, port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () =>
      reject(
        new Error(`Порт ${host}:${port} недоступен. Остановите прежний API/web перед dev:all.`),
      ),
    );
    server.listen(port, host, resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

/** Владеет только своими дочерними процессами. POSIX groups включают grandchildren Docker/Vite, без поиска/kill по имени. */
class DevProcesses {
  constructor({ env, cwd = root, shutdownMs = 20000, onUnexpectedExit = () => {} }) {
    this.env = env;
    this.cwd = cwd;
    this.shutdownMs = shutdownMs;
    this.onUnexpectedExit = onUnexpectedExit;
    this.entries = new Map();
    this.stopping = false;
  }
  /** Запускает без shell: credentials передаются env, но не argv/log. Persistent exit становится ошибкой всего dev-запуска. */
  start(
    name,
    executable,
    args,
    // Только supervisor читает терминал: Vite не должен включать raw input и перехватывать Ctrl+C.
    {
      cwd = this.cwd,
      env = this.env,
      persistent = false,
      gracefulSignalTarget = 'group',
      stdio = ['ignore', 'inherit', 'inherit'],
    } = {},
  ) {
    if (this.stopping) throw new Error('Dev-запуск уже останавливается');
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio,
      detached: process.platform !== 'win32',
    });
    const entry = { child, name, persistent, gracefulSignalTarget, expected: false, closed: false };
    entry.done = new Promise((resolve) => {
      child.once('error', () => {
        entry.error = new Error('Не удалось запустить ' + name);
      });
      child.once('close', (code, signal) => {
        entry.closed = true;
        if (this.entries.get(name) === entry) this.entries.delete(name);
        entry.result = { code, signal, error: entry.error };
        resolve(entry.result);
        if (persistent && !entry.expected && !this.stopping)
          this.onUnexpectedExit(
            new Error(`${name} завершился неожиданно (code=${code}, signal=${signal})`),
          );
      });
    });
    this.entries.set(name, entry);
    return entry;
  }
  /** Подготовительные команды идут последовательно; после failure миграции/сервисы следующего шага не запускаются. */
  async run(name, executable, args, options) {
    const result = await this.start(name, executable, args, options).done;
    if (result.error || result.code !== 0) throw new Error('Не выполнен шаг: ' + name);
  }
  /** Останавливает конкретные owned groups; завершённый PID повторно не сигнализируется. */
  signal(entry, signal) {
    if (entry.closed || !entry.child.pid) return;
    try {
      // Vite сам закрывает esbuild по протоколу; SIGTERM всей группе убивает helper раньше close.
      // Deadline всегда завершает группу, чтобы зависший parent не оставил grandchildren.
      if (
        process.platform === 'win32' ||
        (signal === 'SIGTERM' && entry.gracefulSignalTarget === 'process')
      )
        entry.child.kill(signal);
      else process.kill(-entry.child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw new Error('Не удалось остановить дочерний процесс');
    }
  }
  /** SIGTERM даёт worker время на drain; превышение deadline завершает зависшие группы и делает shutdown неуспешным. */
  async stop(names = [...this.entries.keys()]) {
    const entries = names.map((name) => this.entries.get(name)).filter(Boolean);
    for (const entry of entries) {
      entry.expected = true;
      this.signal(entry, 'SIGTERM');
    }
    if (!entries.length) return;
    let timer;
    try {
      const closed = Promise.all(entries.map((entry) => entry.done));
      const timedOut = await Promise.race([
        closed.then(() => false),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(true), this.shutdownMs);
        }),
      ]);
      if (timedOut) {
        for (const entry of entries) this.signal(entry, 'SIGKILL');
        await closed;
        throw new Error('Превышен срок остановки dev-процессов');
      }
      // Ожидаемый SIGTERM не означает, что drain был успешен: worker может закрыться с exit 1.
      // 130/143 — обычные shell-коды SIGINT/SIGTERM; отменённый preparation оценивает его владелец run.
      const failed = entries.find(
        (entry) =>
          entry.persistent &&
          ((entry.result.code !== null && ![0, 130, 143].includes(entry.result.code)) ||
            (entry.result.signal && !['SIGTERM', 'SIGINT'].includes(entry.result.signal))),
      );
      if (failed) throw new Error(failed.name + ' завершился с ошибкой при остановке');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Проверяет HTTP readiness в bounded loop. Не считает открытый сокет доказательством готовности worker. */
async function waitForHttp(url, stopped, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (!stopped()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Истёк срок ожидания HTTP: ' + url);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(Math.min(1000, remaining)) })).ok) return;
    } catch {
      /* Сервис ещё запускается. */
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(150, Math.max(1, deadline - Date.now()))),
    );
  }
}

/** Один compiler пишет dist. API/worker запускаются только после успешного emit и закрытия прежней пары процессов. */
function watchBackend(manager, fail) {
  const ts = require('../apps/backend/node_modules/typescript');
  const host = ts.createWatchCompilerHost(
    path.join(root, 'apps/backend/tsconfig.build.json'),
    { noEmitOnError: true },
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    (diagnostic) =>
      console.error(
        ts.formatDiagnosticsWithColorAndContext([diagnostic], {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: ts.sys.getCurrentDirectory,
          getNewLine: () => '\n',
        }),
      ),
    (diagnostic) =>
      console.log('[build] ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  );
  const emit = host.afterProgramCreate;
  let revision = 0,
    queue = Promise.resolve();
  host.afterProgramCreate = (builder) => {
    emit(builder);
    if (
      ts
        .getPreEmitDiagnostics(builder.getProgram())
        .some((d) => d.category === ts.DiagnosticCategory.Error)
    )
      return;
    const current = ++revision;
    // Новый emit может прийти во время drain. Очередь и revision не допускают двух пар API/worker.
    queue = queue
      .then(async () => {
        if (manager.stopping || current !== revision) return;
        await manager.stop(['api', 'worker']);
        if (manager.stopping || current !== revision) return;
        console.log('[dev:all] Запуск API и worker после успешной компиляции');
        const api = manager.start(
          'api',
          process.execPath,
          [path.join(root, 'apps/backend/dist/main.js')],
          { persistent: true },
        );
        const worker = manager.start(
          'worker',
          process.execPath,
          [path.join(root, 'apps/backend/dist/worker.js')],
          { persistent: true },
        );
        console.log(`[dev:all] API pid=${api.child.pid}, worker pid=${worker.child.pid}`);
      })
      .catch(fail);
  };
  return ts.createWatchProgram(host);
}

/** Главный сценарий: .env не переписывается, bootstrap/seed не запускаются, PostgreSQL при выходе сохраняется. */
async function main() {
  if (process.argv.length > 2)
    throw new Error('Использование: pnpm dev:all; настройки задаются в root .env');
  if (!fs.existsSync(path.join(root, '.env')))
    throw new Error('Создайте root .env по .env.example и заполните auth-настройки');
  const config = readDevConfiguration(
    parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')),
    process.env,
  );
  await assertPortAvailable(config.apiHost, config.apiPort);
  await assertPortAvailable(config.webHost, config.webPort);
  let resolveStop,
    watcher,
    shutdown,
    exitCode = 0;
  const stopped = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const manager = new DevProcesses({ env: config.env, onUnexpectedExit: fail });
  function fail(error) {
    console.error('[dev:all] ' + error.message);
    requestStop(1);
  }
  function requestStop(code) {
    exitCode = Math.max(exitCode, code);
    manager.stopping = true;
    watcher?.close();
    // Не ждём завершения build/Compose: Ctrl+C должен прервать текущий подготовительный шаг сразу.
    shutdown ??= manager.stop().catch((error) => {
      exitCode = 1;
      console.error('[dev:all] ' + error.message);
    });
    resolveStop();
  }
  const interrupt = () => requestStop(0);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    const backend = path.join(root, 'apps/backend');
    console.log('[dev:all] Сборка backend и проверка конфигурации');
    await manager.run(
      'build',
      process.execPath,
      [path.join(backend, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'],
      { cwd: backend },
    );
    const runtime =
      require('../apps/backend/dist/infrastructure/config/environment').validateEnvironment(
        config.env,
      );
    require('../apps/backend/dist/modules/identity/identity.config').validateIdentityConfig(
      config.env,
    );
    const worker =
      require('../apps/backend/dist/infrastructure/worker/worker.config').validateWorkerEnvironment(
        config.env,
      );
    // Supervisor должен дать обоим процессам их полный deadline и запас на закрытие compiler/Vite.
    const {
      API_SHUTDOWN_TIMEOUT_MS,
    } = require('../apps/backend/dist/infrastructure/lifecycle/api-process');
    manager.shutdownMs = Math.max(worker.shutdownTimeoutMs, API_SHUTDOWN_TIMEOUT_MS) + 5000;
    if (manager.stopping) return;
    console.log('[dev:all] PostgreSQL и миграции');
    await manager.run('postgres', 'docker', [
      'compose',
      '--env-file',
      path.join(root, '.env'),
      '-f',
      path.join(root, 'infra/compose/compose.yaml'),
      'up',
      '-d',
      '--wait',
      'postgres',
    ]);
    await manager.run('migrate', process.execPath, [
      path.join(backend, 'dist/infrastructure/database/migrate.js'),
    ]);
    if (manager.stopping) return;
    watcher = watchBackend(manager, fail);
    manager.start(
      'web',
      process.execPath,
      [
        path.join(root, 'apps/web/node_modules/vite/bin/vite.js'),
        '--host',
        config.webHost,
        '--port',
        String(config.webPort),
        '--strictPort',
      ],
      {
        cwd: path.join(root, 'apps/web'),
        persistent: true,
        gracefulSignalTarget: 'process',
        // Root .env содержит credentials. Vite получает только parent env и server-only proxy target.
        env: { ...process.env, NODE_ENV: 'development', WEB_API_TARGET: config.apiUrl },
      },
    );
    await Promise.all([
      waitForHttp(config.apiUrl + '/health', () => manager.stopping),
      waitForHttp(config.webUrl, () => manager.stopping),
    ]);
    if (!manager.stopping)
      console.log(
        `[dev:all] Web: ${config.webUrl} | API: http://${runtime.httpHost === '::1' ? '[::1]' : runtime.httpHost}:${runtime.port} | Ctrl+C — остановить процессы`,
      );
    await stopped;
  } catch (error) {
    // Signal во время preparation не считается ошибкой команды, прерванной самим оператором.
    if (!manager.stopping) fail(error);
  } finally {
    manager.stopping = true;
    watcher?.close();
    try {
      await (shutdown ?? manager.stop());
    } catch (error) {
      exitCode = 1;
      console.error('[dev:all] ' + error.message);
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    process.exitCode = exitCode;
    console.log('[dev:all] Процессы остановлены. PostgreSQL и данные сохранены.');
  }
}

module.exports = { readDevConfiguration, assertPortAvailable, DevProcesses, waitForHttp };
if (require.main === module)
  main().catch((error) => {
    console.error('[dev:all] ' + error.message);
    process.exitCode = 1;
  });
