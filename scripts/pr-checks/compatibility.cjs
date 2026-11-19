/** @file WMS-601: fail-closed API/events/migration diff против закреплённого Git checkpoint.
 * Git используется только для чтения; базовая ревизия не выводится из изменяемого HEAD.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { ownFiles } = require('./source-inventory.cjs');
const { assertCompatible, canonical } = require('../registry/contracts.cjs');
/** Убирает только document annotations. Имена properties/maps не являются аннотациями:
 * поле description и discriminator.mapping.description сохраняют свой wire-смысл.
 * const/enum/default содержат данные, поэтому обход не удаляет из них одноимённые keys.
 */
function structural(value, isMap = false) {
  if (Array.isArray(value)) return value.map((child) => structural(child));
  if (!value || typeof value !== 'object') return value;
  const maps = new Set([
    'properties',
    'patternProperties',
    '$defs',
    'definitions',
    'schemas',
    'paths',
    'responses',
    'content',
    'headers',
    'securitySchemes',
    'parameters',
    'links',
    'callbacks',
    'mapping',
    'scopes',
    'encoding',
  ]);
  const annotations = new Set([
    'description',
    'summary',
    'title',
    'example',
    'examples',
    'externalDocs',
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => isMap || !annotations.has(key))
      .map(([key, child]) => [
        key,
        !isMap && ['const', 'enum', 'default'].includes(key)
          ? child
          : structural(child, !isMap && maps.has(key)),
      ]),
  );
}
/** Не разрешает исчезновение endpoint, response, security или schema под прежним именем.
 * Новые paths/operations/components допускаются, пока прежние references сохраняют контракт. */
function assertApiCompatible(previous, candidate) {
  for (const key of ['openapi', 'security', 'servers'])
    assert.equal(
      canonical(structural(candidate[key])),
      canonical(structural(previous[key])),
      `API ${key} changed`,
    );
  for (const [name, schema] of Object.entries(previous.components?.schemas ?? {}))
    assert.equal(
      canonical(structural(candidate.components?.schemas?.[name])),
      canonical(structural(schema)),
      `API schema changed: ${name}`,
    );
  for (const [name, schemes] of Object.entries(previous.components ?? {})) {
    if (name === 'schemas') continue;
    for (const [id, value] of Object.entries(schemes))
      assert.equal(
        canonical(structural(candidate.components?.[name]?.[id])),
        canonical(structural(value)),
        `API component changed: ${name}.${id}`,
      );
  }
  for (const [route, item] of Object.entries(previous.paths ?? {}))
    for (const [method, operation] of Object.entries(item))
      assert.equal(
        canonical(structural(candidate.paths?.[route]?.[method])),
        canonical(structural(operation)),
        `API operation changed: ${method} ${route}`,
      );
}
/** Возвращает exact commit из source policy. Нет fallback на HEAD при missing/невалидной настройке. */
function releaseBase(root) {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts/pr-checks/release.json'), 'utf8'),
  );
  assert.equal(config.version, 1, 'Unknown release policy');
  assert.match(config.baseCommit, /^[a-f0-9]{40}$/, 'Expected exact release commit');
  const resolved = execFileSync('git', ['rev-parse', '--verify', config.baseCommit + '^{commit}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  assert.equal(resolved, config.baseCommit, 'Invalid release checkpoint');
  execFileSync('git', ['merge-base', '--is-ancestor', resolved, 'HEAD'], {
    cwd: root,
    stdio: 'pipe',
  });
  return resolved;
}
/** Проверяет base/current trees; injected readers служат disposable regression fixtures.
 * Любое исчезновение старой event schema запрещено, даже если current registry уже её не перечисляет. */
function compareRelease({ previousFiles, currentFiles, previous, current }) {
  const oldApi = previous('docs/contracts/openapi.json');
  assertApiCompatible(JSON.parse(oldApi), JSON.parse(current('docs/contracts/openapi.json')));
  if (previousFiles.includes('docs/contracts/kafka-topology.json'))
    assert.equal(
      canonical(JSON.parse(current('docs/contracts/kafka-topology.json'))),
      canonical(JSON.parse(previous('docs/contracts/kafka-topology.json'))),
      'Kafka topology requires explicit cutover review',
    );
  for (const file of previousFiles.filter((f) =>
    /^docs\/contracts\/events\/.*\.schema\.json$/.test(f),
  )) {
    assert.ok(currentFiles.includes(file), `Removed event contract: ${file}`);
    assertCompatible(JSON.parse(previous(file)), JSON.parse(current(file)), file);
  }
  for (const file of previousFiles.filter((f) => /^apps\/backend\/drizzle\//.test(f))) {
    if (file.endsWith('/README.md') || file.endsWith('/meta/_journal.json')) continue;
    assert.ok(currentFiles.includes(file), `Removed applied migration: ${file}`);
    assert.equal(current(file), previous(file), `Changed applied migration: ${file}`);
  }
  const journal = 'apps/backend/drizzle/meta/_journal.json';
  const oldEntries = JSON.parse(previous(journal));
  const newEntries = JSON.parse(current(journal));
  assert.equal(newEntries.version, oldEntries.version, 'Migration journal format changed');
  assert.equal(newEntries.dialect, oldEntries.dialect, 'Migration journal dialect changed');
  assert.deepEqual(
    newEntries.entries.slice(0, oldEntries.entries.length),
    oldEntries.entries,
    'Applied migration journal changed',
  );
}
/** Сравнивает полный baseline, включая уже закоммиченные breaking changes после checkpoint. */
function checkCompatibility(root) {
  const base = releaseBase(root);
  const previousFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', base], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  const currentFiles = ownFiles(root);
  compareRelease({
    previousFiles,
    currentFiles,
    previous: (file) =>
      execFileSync('git', ['show', base + ':' + file], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }),
    current: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
  });
  return base;
}
if (require.main === module) {
  try {
    console.log(
      'Release compatibility passed: ' + checkCompatibility(path.resolve(__dirname, '../..')),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { assertApiCompatible, compareRelease, releaseBase, checkCompatibility };
