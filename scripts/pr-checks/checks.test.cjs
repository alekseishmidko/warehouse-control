/** @file WMS-601: disposable fixtures доказывают отказы docs/compatibility/frozen install и остановку настоящего runner. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { checkDocumentation, linkErrors, publicDocErrors, anchors } = require('./documentation.cjs');
const { compareRelease, assertApiCompatible } = require('./compatibility.cjs');
/** Синтетические wire contracts не содержат складскую логику; типы проверяет production guard. */
function contracts() {
  return {
    'docs/contracts/openapi.json': JSON.stringify({
      openapi: '3.0.0',
      paths: { '/api/test': { get: { responses: { 200: { description: 'ok' } } } } },
      components: {
        schemas: {
          Receipt: {
            type: 'object',
            properties: { description: { type: 'string' }, amount: { type: 'integer' } },
          },
        },
      },
    }),
    'docs/contracts/events/test.v1.schema.json': JSON.stringify({
      type: 'object',
      properties: { quantity: { type: 'integer' } },
      required: ['quantity'],
    }),
    'apps/backend/drizzle/0000.sql': 'create table original(id int);',
    'apps/backend/drizzle/meta/_journal.json': JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [{ idx: 0, tag: '0000', when: 1 }],
    }),
  };
}
/** Проверяет снимки как неизменяемые readers, не редактирует рабочие contracts. */
function compare(previous, current) {
  return compareRelease({
    previousFiles: Object.keys(previous),
    currentFiles: Object.keys(current),
    previous: (f) => previous[f],
    current: (f) => current[f],
  });
}
test('API event and migration guards reject breaking changes including removed historical schema', () => {
  const old = contracts();
  compare(old, structuredClone(old));
  for (const mutate of [
    (c) => {
      const api = JSON.parse(c['docs/contracts/openapi.json']);
      api.components.schemas.Receipt.properties.description.type = 'number';
      c['docs/contracts/openapi.json'] = JSON.stringify(api);
    },
    (c) => {
      delete c['docs/contracts/events/test.v1.schema.json'];
    },
    (c) => {
      c['docs/contracts/events/test.v1.schema.json'] = JSON.stringify({
        type: 'object',
        properties: { quantity: { type: 'string' } },
        required: ['quantity'],
      });
    },
    (c) => {
      c['apps/backend/drizzle/0000.sql'] = 'drop table original;';
    },
    (c) => {
      c['apps/backend/drizzle/meta/_journal.json'] = JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [],
      });
    },
  ]) {
    const candidate = structuredClone(old);
    mutate(candidate);
    assert.throws(() => compare(old, candidate));
  }
  const api = JSON.parse(old['docs/contracts/openapi.json']);
  const candidate = structuredClone(api);
  candidate.paths['/api/new'] = { get: { responses: { 200: { description: 'new' } } } };
  assert.doesNotThrow(() => assertApiCompatible(api, candidate));
  const withMapping = structuredClone(api);
  withMapping.components.schemas.Receipt.discriminator = {
    propertyName: 'kind',
    mapping: { description: '#/components/schemas/Receipt' },
  };
  const changedMapping = structuredClone(withMapping);
  changedMapping.components.schemas.Receipt.discriminator.mapping.description =
    '#/components/schemas/Other';
  assert.throws(() => assertApiCompatible(withMapping, changedMapping));
  candidate.components.schemas.Receipt.properties.amount = {
    type: 'integer',
    const: { description: 'changed constraint' },
  };
  assert.throws(() => assertApiCompatible(api, candidate));
});
test('documentation detects missing links catalog and file docs', () => {
  assert.ok(anchors('# `GET` route').has('get-route'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-docs-'));
  try {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(
      path.join(root, 'docs/file-catalog.md'),
      '`docs/file-catalog.md` `a.ts` `README.md`',
    );
    fs.writeFileSync(
      path.join(root, 'a.ts'),
      '/** @file test source */\n/** Public action contract. */\nexport function run() {}',
    );
    fs.writeFileSync(path.join(root, 'README.md'), '# Main\n[link](a.ts:3)\n[heading](#main)\n');
    const files = ['docs/file-catalog.md', 'a.ts', 'README.md'];
    assert.deepEqual(checkDocumentation(root, files), []);
    fs.writeFileSync(
      path.join(root, 'a.ts'),
      '/** Intro without file marker. */\nexport function missingDocs() {}\n/** @file misplaced */',
    );
    const errors = checkDocumentation(root, files);
    assert.ok(errors.some((e) => e.includes('@file')));
    assert.ok(errors.some((e) => e.includes('catalog')) === false);
    assert.ok(publicDocErrors('a.ts', 'export function missingDocs() {}').length > 0);
    assert.ok(publicDocErrors('a.ts', 'export const missingDocs = () => 1;').length > 0);
    assert.ok(linkErrors(root, 'README.md', '[bad](missing.md) [bad](#absent)').length === 2);
    fs.writeFileSync(
      path.join(root, 'docs/file-catalog.md'),
      '`README.md` `docs/file-catalog.md` `a.ts.old`',
    );
    assert.ok(checkDocumentation(root, files).some((e) => e === 'catalog missing: a.ts'));
    fs.symlinkSync(os.tmpdir(), path.join(root, 'external'));
    assert.ok(linkErrors(root, 'README.md', '[outside](external)').length === 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('breaking contracts stop the pipeline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-breaking-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), value);
  };
  try {
    const old = contracts();
    for (const [f, c] of Object.entries(old)) write(f, c);
    write('.gitignore', 'artifacts/\n');
    write('spec.cjs', '/** @file fixture source reference */');
    write(
      'gate.cjs',
      `/** @file invokes actual compatibility boundary */\nrequire(${JSON.stringify(path.resolve(__dirname, 'compatibility.cjs'))}).checkCompatibility(process.cwd());`,
    );
    write(
      'package.json',
      JSON.stringify({
        packageManager: 'pnpm@10.18.3',
        scripts: {
          'deps:check': 'node -e "process.exit(0)"',
          'check:pr':
            "node gate.cjs && node -e \"require('node:fs').writeFileSync('SHOULD_NOT_RUN','unsafe')\"",
          'docker:image-check': 'node spec.cjs',
        },
      }),
    );
    git('init');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    git('add', '.');
    git('commit', '-m', 'compatible');
    const base = git('rev-parse', 'HEAD');
    write('scripts/pr-checks/release.json', JSON.stringify({ version: 1, baseCommit: base }));
    const broken = JSON.parse(old['docs/contracts/openapi.json']);
    broken.components.schemas.Receipt.properties.amount.type = 'string';
    write('docs/contracts/openapi.json', JSON.stringify(broken));
    git('add', '.');
    git('commit', '-m', 'breaking committed contract');
    write(
      'task.json',
      JSON.stringify({
        version: 1,
        id: 'poison',
        issuedBy: 'fixture',
        request: 'negative pipeline proof',
        base: git('rev-parse', 'HEAD'),
        criteria: [
          {
            id: 'NEG-1',
            statement: 'break must fail',
            tests: ['spec.cjs#negative'],
            gates: ['pr'],
          },
        ],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../harness/cli.cjs'), 'run', 'task.json'],
      { cwd: root, encoding: 'utf8', timeout: 30000 },
    );
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    const state = JSON.parse(
      fs.readFileSync(path.join(root, 'artifacts/harness/poison/latest.json')),
    );
    assert.equal(state.status, 'failed');
    assert.deepEqual(
      state.results.map((r) => r.id),
      ['install', 'pr'],
    );
    assert.equal(state.results[0].code, 0);
    assert.notEqual(state.results[1].code, 0);
    assert.equal(fs.existsSync(path.join(root, 'SHOULD_NOT_RUN')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('frozen install rejects changed manifest without rewriting lockfile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-frozen-'));
  try {
    const packageFile = path.join(root, 'package.json');
    fs.writeFileSync(
      packageFile,
      JSON.stringify({ name: 'frozen-fixture', private: true, packageManager: 'pnpm@10.18.3' }),
    );
    execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], {
      cwd: root,
      stdio: 'pipe',
      timeout: 30000,
    });
    const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
    fs.writeFileSync(
      packageFile,
      JSON.stringify({
        name: 'frozen-fixture',
        private: true,
        packageManager: 'pnpm@10.18.3',
        dependencies: { 'must-not-be-downloaded': '0.0.0' },
      }),
    );
    const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--offline'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, CI: 'true' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /OUTDATED_LOCKFILE|frozen-lockfile/i);
    assert.equal(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'), lock);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
