/** @file Проверки dev supervisor: локальный env, занятые порты, настоящие child processes и bounded shutdown без Docker. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const net = require('node:net');
const http = require('node:http');
const {
  readDevConfiguration,
  assertPortAvailable,
  DevProcesses,
  waitForHttp,
} = require('./dev-all.cjs');

/** Только синтетический пароль. Не читает рабочую .env и не подключается к PostgreSQL. */
const env = {
  NODE_ENV: 'development',
  PORT: '3000',
  POSTGRES_PORT: '15432',
  POSTGRES_USER: 'warehouse',
  POSTGRES_PASSWORD: 'synthetic-local-password',
  POSTGRES_DB: 'warehouse',
  DATABASE_URL: 'postgresql://warehouse:synthetic-local-password@127.0.0.1:15432/warehouse',
  AUTH_ORIGIN: 'http://127.0.0.1:5173',
};
test('ошибка drain сервиса не становится успешным shutdown', { timeout: 5000 }, async () => {
  const manager = new DevProcesses({ env: process.env, shutdownMs: 1000 });
  const entry = manager.start(
    'worker',
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM',()=>process.exit(1));setInterval(()=>{},1000);process.send('ready')",
    ],
    {
      persistent: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  try {
    // Handler установлен до сигнала; exit 1 моделирует неуспешный bounded drain production worker.
    await once(entry.child, 'message');
    await assert.rejects(manager.stop(), /с ошибкой/);
  } finally {
    await manager.stop();
  }
});
test('конфигурация сохраняет приоритет process env и не изменяет исходный объект', () => {
  const copy = { ...env };
  const config = readDevConfiguration(copy, { PORT: '3001', AUTH_ORIGIN: 'http://localhost:5174' });
  assert.equal(config.apiUrl, 'http://127.0.0.1:3001');
  assert.equal(config.webHost, 'localhost');
  assert.equal(config.webPort, 5174);
  assert.deepEqual(copy, env);
});
test('production, внешняя БД/origin, совпадение портов и несовместимые credentials отклоняются без утечки значений', () => {
  for (const change of [
    { NODE_ENV: 'production' },
    { DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'remote.example') },
    { AUTH_ORIGIN: 'http://example.org:5173' },
    { AUTH_ORIGIN: 'https://127.0.0.1:5173' },
    { AUTH_ORIGIN: 'http://127.0.0.1:5173/path' },
    { AUTH_ORIGIN: 'http://127.0.0.1:3000' },
    { POSTGRES_PORT: '5173' },
    { PORT: 'invalid' },
    { HTTP_HOST: '0.0.0.0' },
    { POSTGRES_PASSWORD: 'another-secret' },
    { DATABASE_URL: undefined },
  ]) {
    assert.throws(
      () => readDevConfiguration({ ...env, ...change }),
      (error) => {
        assert.ok(!error.message.includes(env.POSTGRES_PASSWORD));
        assert.ok(!error.message.includes('another-secret'));
        return true;
      },
    );
  }
});
test('занятый порт отклоняется; после закрытия listener порт доступен', async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    await assert.rejects(assertPortAvailable('127.0.0.1', port), /недоступен/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assertPortAvailable('127.0.0.1', port);
});

/** IPC ready — barrier: handler SIGTERM уже установлен к моменту stop, случайного sleep в тестах нет. */
function child(manager, name, { ignoreSignal = false, persistent = true } = {}) {
  const entry = manager.start(
    name,
    process.execPath,
    [
      '-e',
      `
    process.on('SIGTERM', () => { ${ignoreSignal ? '' : 'process.exit(0);'} });
    setInterval(() => {}, 1000);
    process.send('ready');
  `,
    ],
    { persistent, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  );
  return { entry, ready: once(entry.child, 'message') };
}
test(
  'SIGTERM завершает owned процессы и не вызывает unexpected exit',
  { timeout: 5000 },
  async () => {
    const errors = [];
    const manager = new DevProcesses({
      env: process.env,
      shutdownMs: 1000,
      onUnexpectedExit: (e) => errors.push(e),
    });
    const a = child(manager, 'api'),
      b = child(manager, 'worker');
    try {
      await Promise.all([a.ready, b.ready]);
      await manager.stop();
      assert.equal(manager.entries.size, 0);
      assert.equal(a.entry.closed && b.entry.closed, true);
      assert.deepEqual(errors, []);
    } finally {
      await manager.stop();
    }
  },
);
test(
  'неожиданный exit одного сервиса позволяет остановить оставшиеся',
  { timeout: 5000 },
  async () => {
    let failed;
    const failure = new Promise((resolve) => {
      failed = resolve;
    });
    const manager = new DevProcesses({
      env: process.env,
      shutdownMs: 1000,
      onUnexpectedExit: failed,
    });
    const sibling = child(manager, 'worker');
    try {
      await sibling.ready;
      manager.start('api', process.execPath, ['-e', 'process.exit(3)'], {
        persistent: true,
        stdio: 'ignore',
      });
      assert.match((await failure).message, /api.*code=3/);
      manager.stopping = true;
      await manager.stop();
      assert.equal(sibling.entry.closed, true);
    } finally {
      await manager.stop();
    }
  },
);
test(
  'зависший процесс получает SIGKILL после deadline, shutdown не выдаёт ложный успех',
  { timeout: 5000 },
  async () => {
    const manager = new DevProcesses({ env: process.env, shutdownMs: 50 });
    const hung = child(manager, 'worker', { ignoreSignal: true });
    try {
      await hung.ready;
      await assert.rejects(manager.stop(), /Превышен срок/);
      assert.equal((await hung.entry.done).signal, 'SIGKILL');
      assert.equal(hung.entry.closed, true);
    } finally {
      await manager.stop();
    }
  },
);
test(
  'ошибка preparation/spawn выходит вызывающему; preparation можно прервать',
  { timeout: 5000 },
  async () => {
    const manager = new DevProcesses({ env: process.env, shutdownMs: 1000 });
    await assert.rejects(
      manager.run('missing', '/nonexistent/wms-dev-command', [], { stdio: 'ignore' }),
      /Не выполнен шаг/,
    );
    const work = manager.run(
      'build',
      process.execPath,
      ['-e', "process.send('ready');setInterval(()=>{},1000)"],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    const rejected = assert.rejects(work, /Не выполнен шаг/);
    try {
      await once(manager.entries.get('build').child, 'message');
      manager.stopping = true;
      await manager.stop();
      await rejected;
      assert.throws(() => manager.start('late', process.execPath, []), /останавливается/);
    } finally {
      await manager.stop();
    }
  },
);
test(
  'HTTP readiness ждёт успешный ответ; deadline и остановка остаются явными',
  { timeout: 5000 },
  async () => {
    let attempts = 0;
    const server = http.createServer((_req, res) => {
      attempts++;
      res.statusCode = attempts === 1 ? 503 : 200;
      res.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      await waitForHttp(url, () => false, 2000);
      assert.ok(attempts >= 2);
      await waitForHttp('invalid-url', () => true, 1);
      await assert.rejects(
        waitForHttp('invalid-url', () => false, 5),
        /Истёк срок/,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
