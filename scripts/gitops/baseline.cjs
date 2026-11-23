/** @file WMS-604 R2: fresh Docker build → scan exact bytes → checked local kind import; прежний GHCR image не развёртывается. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { runtimeSourceSnapshot, verifyRuntimeSource } = require('./runtime-source.cjs');
const { snapshot, hash } = require('../harness/snapshot.cjs');
const { scanLocalImages } = require('../image-release/scan.cjs');
const { importCheckedImage } = require('./import.cjs');
/** Строит исходники текущего checkout с allowlist context, проверяет неизменность inputs/config и импортирует только scanned config. */
async function prepareBaseline(session) {
  const root = path.resolve('.'),
    sourceSnapshot = snapshot(root).digest;
  const runtimeSources = runtimeSourceSnapshot(root),
    built = {};
  for (const app of ['backend', 'web']) {
    session.run('docker', [
      'build',
      '-f',
      'apps/' + app + '/Dockerfile',
      '-t',
      'warehouse-' + app + ':local',
      '.',
    ]);
    built[app] = JSON.parse(
      session.run('docker', ['image', 'inspect', 'warehouse-' + app + ':local']),
    )[0].Id;
  }
  verifyRuntimeSource(runtimeSources, root);
  assert.equal(snapshot(root).digest, sourceSnapshot, 'Source changed during baseline build');
  const scan = await scanLocalImages();
  assert.equal(scan.summary.sourceSnapshot, sourceSnapshot, 'Scan must bind the current source');
  const images = {},
    proof = [];
  for (const app of ['backend', 'web']) {
    const checked = scan.summary.images.find((i) => i.app === app);
    assert.equal(checked.imageId, built[app], 'Scanned tag changed after build');
    const current = JSON.parse(
      session.run('docker', ['image', 'inspect', 'warehouse-' + app + ':local']),
    )[0].Id;
    assert.equal(current, checked.imageId, 'Scanned tag changed before import');
    const tag = 'warehouse-' + app + ':' + session.cluster + '-baseline';
    session.run('docker', ['tag', checked.imageId, tag]);
    session.ownedImages.push(tag);
    const digest = importCheckedImage(session, tag, 'baseline-' + app);
    const cri = JSON.parse(
      session.run('docker', [
        'exec',
        session.cluster + '-control-plane',
        'crictl',
        'inspecti',
        'docker.io/library/' + tag,
      ]),
    ).status;
    assert.equal(cri.id, checked.configId, 'Loaded runtime differs from scanned config');
    images[app] = { repository: 'warehouse-' + app, digest, pullPolicy: 'Never', tag };
    proof.push({
      app,
      imageId: checked.imageId,
      configId: cri.id,
      reference: images[app].repository + '@' + digest,
    });
  }
  verifyRuntimeSource(runtimeSources, root);
  return {
    images,
    runtimeSources,
    proof: {
      sourceSnapshot,
      runtimeSources,
      scanFile: path.relative(root, scan.file),
      scanSha256: hash(fs.readFileSync(scan.file)),
      images: proof,
    },
  };
}
module.exports = { prepareBaseline };
