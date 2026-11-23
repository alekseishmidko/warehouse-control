/** @file WMS-603/604: временный additive/fault release image для disposable rehearsal; applied source SQL не меняется. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
/** Добавляет один test-only SQL в journal базового image; индекс/when вычисляются из фактического base, не hardcoded. */
function buildFixtureImage(session, base, suffix, sql) {
  assert.match(
    base,
    /^(?:ghcr\.io\/alekseishmidko\/warehouse-control\/backend@sha256:[a-f0-9]{64}|warehouse-backend:wms-gitops-[a-z0-9-]+)$/,
  );
  assert.match(suffix, /^[a-z][a-z0-9-]{0,30}$/);
  const tag = 'warehouse-backend:' + session.cluster + '-' + suffix;
  const directory = path.join(session.directory, suffix);
  fs.mkdirSync(directory);
  console.log('RUN fixture base identity ' + suffix);
  const before = JSON.parse(session.run('docker', ['image', 'inspect', base]))[0].Id;
  console.log('RUN fixture base journal ' + suffix);
  const journal = JSON.parse(
    session.run('docker', [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--entrypoint',
      'node',
      base,
      '-e',
      "process.stdout.write(require('node:fs').readFileSync('drizzle/meta/_journal.json'))",
    ]),
  );
  const previous = journal.entries.at(-1);
  assert.ok(Number.isInteger(previous.idx) && Number.isSafeInteger(previous.when));
  const name = String(previous.idx + 1).padStart(4, '0') + '_gitops_' + suffix.replaceAll('-', '_');
  journal.entries.push({
    idx: previous.idx + 1,
    version: previous.version,
    when: previous.when + 1,
    tag: name,
    breakpoints: true,
  });
  fs.writeFileSync(path.join(directory, '_journal.json'), JSON.stringify(journal));
  fs.writeFileSync(path.join(directory, name + '.sql'), sql);
  fs.writeFileSync(
    path.join(directory, 'Dockerfile'),
    `FROM ${base}\nCOPY --chown=node:node _journal.json ./drizzle/meta/_journal.json\nCOPY --chown=node:node ${name}.sql ./drizzle/${name}.sql\n`,
  );
  console.log('RUN fixture build ' + suffix);
  session.run('docker', ['build', '-t', tag, directory]);
  session.ownedImages.push(tag);
  assert.equal(
    JSON.parse(session.run('docker', ['image', 'inspect', base]))[0].Id,
    before,
    'Fixture base changed during build',
  );
  console.log('RUN fixture import ' + suffix);
  const digest = require('../gitops/import.cjs').importCheckedImage(session, tag, suffix);
  const imageId = JSON.parse(session.run('docker', ['image', 'inspect', tag]))[0].Id;
  return {
    tag,
    repository: 'warehouse-backend',
    digest,
    pullPolicy: 'IfNotPresent',
    imageId,
    migration: name,
    journal,
  };
}
module.exports = { buildFixtureImage };
