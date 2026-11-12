/** @file Реальный HTTP receiver: firing/resolved, bounded fields/journal и отсутствие внешних destinations. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createReceiver } = require('../../infra/observability/receiver.cjs');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
test('local receiver retains bounded safe labels and firing/resolved notifications', async () => {
  const server = createReceiver();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    for (let i = 0; i < 102; i++) {
      const response = await fetch(url + '/alerts', {
        method: 'POST',
        body: JSON.stringify({
          status: i === 101 ? 'resolved' : 'firing',
          alerts: [
            {
              status: i === 101 ? 'resolved' : 'firing',
              labels: {
                alertname: 'WmsDeadDelivery',
                severity: 'warning',
                instance: 'x'.repeat(1000),
                token: 'PRIVATE_TOKEN',
              },
            },
          ],
        }),
      });
      assert.equal(response.status, 200);
    }
    const journal = await (await fetch(url + '/notifications')).json();
    assert.equal(journal.length, 100);
    assert.equal(journal.at(-1).status, 'resolved');
    assert.equal(journal[0].alerts[0].labels.instance.length, 128);
    assert.ok(!JSON.stringify(journal).includes('PRIVATE_TOKEN'));
    assert.equal((await fetch(url + '/alerts', { method: 'POST', body: 'null' })).status, 400);
    assert.equal((await fetch(url + '/missing')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** Wall clock может шагнуть при wake/NTP; readiness retry должен использовать monotonic deadline. */
test('driver readiness survives wall-clock jump between real HTTP attempts', async () => {
  const { createObservabilityGate } = require('./gate.cjs');
  const { mkdtemp, writeFile, rm } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const http = require('node:http');
  const directory = await mkdtemp(join(tmpdir(), 'wms402-clock-'));
  const originalNow = Date.now;
  let offset = 0,
    calls = 0;
  Date.now = () => originalNow() + offset;
  const server = http.createServer((_req, res) => {
    calls++;
    if (calls === 1) {
      offset = 86400000;
      res.writeHead(503).end();
    } else res.writeHead(200).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const envFile = join(directory, 'gate.env');
  try {
    await writeFile(envFile, 'POSTGRES_PASSWORD=synthetic\n', { mode: 0o600 });
    const gate = createObservabilityGate({
      project: 'clock-test',
      envFile,
      run: async (args) => (args.includes('port') ? `127.0.0.1:${server.address().port}` : ''),
    });
    await gate.start();
    assert.ok(calls >= 6, 'first503 must be retried before all service readiness checks');
  } finally {
    Date.now = originalNow;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

/** Реальный child process получает SIGTERM во время незавершённого POST: timeout HTTP не удерживает exit. */
test('receiver drains SIGTERM and bounds an unfinished HTTP body', { timeout: 10000 }, async () => {
  const http = require('node:http');
  const path = resolve(__dirname, '../../infra/observability/receiver.cjs');
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const server=require(${JSON.stringify(path)}).startReceiver(0);
    server.on('listening',()=>process.send({port:server.address().port}));
    server.on('request',()=>process.send({request:true}));
    server.on('close',()=>process.disconnect());
  `,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  let request;
  let timer;
  const exited = once(child, 'exit');
  try {
    const [ready] = await once(child, 'message');
    const received = once(child, 'message');
    request = http.request({
      host: '127.0.0.1',
      port: ready.port,
      path: '/alerts',
      method: 'POST',
      headers: { 'Content-Length': 1000 },
    });
    request.on('error', () => {});
    request.write('{');
    assert.equal((await received)[0].request, true, 'server received incomplete body');
    child.kill('SIGTERM');
    const [code, signal] = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('receiver shutdown deadline')), 5000);
      }),
    ]);
    assert.equal(code, 0);
    assert.equal(signal, null);
  } finally {
    clearTimeout(timer);
    request?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
});
