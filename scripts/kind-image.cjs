/** @file Canonical manifest digest локального image после kind import: проверка config hash без доверия изменяемому tag. */
const assert = require('node:assert/strict');
const { join } = require('node:path');
/** Сверяет Docker archive и CRI, регистрирует digest alias. run — bounded argv adapter без shell, cluster — принадлежащий gate. */
function canonicalImage(run, cluster, tag, temp, name) {
  const node = cluster + '-control-plane';
  const imported = JSON.parse(
    run('docker', ['exec', node, 'crictl', 'inspecti', 'docker.io/library/' + tag]),
  ).status;
  const archive = join(temp, name + '.tar');
  run('docker', [
    'image',
    'save',
    '--platform',
    'linux/' + (process.arch === 'arm64' ? 'arm64' : 'amd64'),
    '-o',
    archive,
    tag,
  ]);
  const source = JSON.parse(run('tar', ['-xOf', archive, 'manifest.json']))[0];
  const hash = source.Config.split('/')
    .at(-1)
    .replace(/\.json$/, '');
  assert.equal(imported.id, 'sha256:' + hash);
  const digest = imported.repoDigests[0].split('@')[1];
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  run('docker', [
    'exec',
    node,
    'ctr',
    '--namespace=k8s.io',
    'images',
    'tag',
    'docker.io/library/' + tag,
    'docker.io/library/' + tag.split(':')[0] + '@' + digest,
  ]);
  return digest;
}
module.exports = { canonicalImage };
