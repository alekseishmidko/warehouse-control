/** @file Локальный isolated Registry profile: readiness по HTTP, namespace Compose явный, .env не читается. */
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { root } = require('./contracts.cjs');
/** Только собственное фиксированное семейство project names; remote daemon запрещён. */
function profile(project = process.env.WMS_REGISTRY_PROJECT ?? 'wms-registry') {
  assert.match(project, /^wms-registry(?:-[a-f0-9-]{8,36})?$/);
  const env = { ...process.env, WMS_REGISTRY_PORT: process.env.WMS_REGISTRY_PORT ?? '18081' };
  assert.match(env.WMS_REGISTRY_PORT, /^(?:0|[1-9][0-9]{0,4})$/);
  assert.ok(Number(env.WMS_REGISTRY_PORT) <= 65535, 'invalid Registry port');
  function docker(args) {
    return execFileSync('docker', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 240000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }
  const endpoint =
    env.DOCKER_HOST ??
    JSON.parse(docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  assert.match(endpoint, /^unix:\/\//, 'Registry profile requires local Docker');
  const compose = (args) =>
    docker([
      'compose',
      '--env-file',
      '/dev/null',
      '--project-name',
      project,
      '-f',
      'infra/registry/compose.yaml',
      ...args,
    ]);
  const url = () => {
    const address = compose(['port', 'registry', '8080']);
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    return 'http://' + address;
  };
  async function up() {
    compose(['up', '-d']);
    const base = url(),
      deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(base + '/apis/registry/v3/system/info', {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) return base;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw Error('Registry HTTP readiness deadline');
  }
  return { up, url, down: () => compose(['down', '--volumes', '--remove-orphans']) };
}
if (require.main === module) {
  const mode = process.argv[2];
  assert.ok(['up', 'down'].includes(mode) && process.argv.length === 3);
  const p = profile();
  Promise.resolve(mode === 'up' ? p.up() : p.down())
    .then(() => console.log('PASS Registry ' + mode))
    .catch(() => {
      console.error('Registry ' + mode + ' failed');
      process.exitCode = 1;
    });
}
module.exports = { profile };
