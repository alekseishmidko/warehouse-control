/** @file Настоящий HTTP static server: SPA fallback, MIME/cache, методы и изоляция API/filesystem. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, mkdir, rm, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { createStaticServer } = require('./static-server.cjs');
test('serves built SPA without API/filesystem fallback and closes streams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wms303-static-'));
  const server = createStaticServer(root);
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<html>WMS</html>');
    await writeFile(join(root, 'assets/app.js'), 'console.log(1)');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    for (const route of ['/', '/orders', '/unknown-route']) {
      const r = await fetch(url + route);
      assert.equal(r.status, 200);
      assert.equal(await r.text(), '<html>WMS</html>');
    }
    const asset = await fetch(url + '/assets/app.js');
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), '16');
    for (const route of [
      '/api',
      '/api/v1/auth/me',
      '/assets/missing.js',
      '/missing.css',
      '/%2e%2e%2fsecret',
      '/%00',
    ])
      assert.equal((await fetch(url + route)).status, 404);
    assert.equal((await fetch(url + '/%zz')).status, 400);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    await unlink(join(root, 'index.html'));
    assert.equal((await fetch(url + '/orders')).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
