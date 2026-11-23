/** @file WMS-603: импорт только native ARM64 archive; registry index может ссылаться на незагруженные чужие платформы. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { canonicalImage } = require('../kind-image.cjs');
/** Экспортирует выбранную платформу до kind import, затем общий helper сверяет реальные config bytes и CRI. */
function importCheckedImage(session, tag, name) {
  assert.match(name, /^[a-z0-9-]+$/);
  assert.ok(
    tag.startsWith('warehouse-vendor:' + session.cluster + '-') ||
      tag.startsWith('warehouse-backend:' + session.cluster + '-') ||
      tag.startsWith('warehouse-web:' + session.cluster + '-'),
    'Only owned image tags may be imported',
  );
  if (process.arch !== 'arm64') throw Error('Native ARM64 import required');
  const archive = path.join(session.directory, name + '-load.tar');
  try {
    session.run('docker', ['image', 'save', '--platform', 'linux/arm64', '-o', archive, tag]);
    session.run(session.kind, ['load', 'image-archive', archive, '--name', session.cluster]);
  } finally {
    fs.rmSync(archive, { force: true });
  }
  try {
    return canonicalImage(session.run, session.cluster, tag, session.directory, name);
  } finally {
    fs.rmSync(path.join(session.directory, name + '.tar'), { force: true });
  }
}
module.exports = { importCheckedImage };
