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

test('image scan policy fails closed and binds findings to the inspected image', () => {
  const { validateReport } = require('../image-release/scan.cjs');
  const imageId = 'sha256:' + 'a'.repeat(64);
  const report = () => ({
    SchemaVersion: 2,
    ArtifactType: 'container_image',
    Metadata: { ImageID: imageId },
    Results: [{ Target: 'Debian', Class: 'os-pkgs', Vulnerabilities: [] }],
  });
  assert.equal(validateReport(report(), imageId).HIGH, 0);
  for (const severity of ['HIGH', 'CRITICAL', 'UNKNOWN', 'unexpected']) {
    const candidate = report();
    // FixedVersion отсутствует: unfixed advisory также блокирует release.
    candidate.Results[0].Vulnerabilities.push({
      VulnerabilityID: 'CVE-test',
      PkgName: 'lib',
      Severity: severity,
    });
    assert.throws(() => validateReport(candidate, imageId));
  }
  const low = report();
  low.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'CVE-test',
    PkgName: 'lib',
    Severity: 'LOW',
  });
  assert.equal(validateReport(low, imageId).LOW, 1);
  for (const mutate of [
    (r) => {
      r.Metadata.ImageID = 'sha256:' + 'b'.repeat(64);
    },
    (r) => {
      r.Results = [];
    },
    (r) => {
      delete r.Metadata;
    },
    (r) => {
      r.Results[0].Vulnerabilities = {};
    },
    (r) => {
      r.Results.push(null);
    },
    (r) => {
      r.SchemaVersion = 1;
    },
  ]) {
    const candidate = report();
    mutate(candidate);
    assert.throws(() => validateReport(candidate, imageId));
  }
  assert.throws(() => validateReport({}, imageId));
  assert.throws(() => validateReport(null, imageId));
});

// Overrides scanner не должны превращать advisory в чистый отчёт.
test('image scanner discards ambient policy overrides', () => {
  const { scannerEnvironment } = require('../image-release/scan.cjs');
  assert.deepEqual(
    scannerEnvironment({
      PATH: '/bin',
      HTTPS_PROXY: 'proxy',
      TRIVY_SEVERITY: 'LOW',
      TRIVY_SKIP_DB_UPDATE: 'true',
      TRIVY_IGNORE_STATUS: 'affected',
    }),
    { PATH: '/bin', HTTPS_PROXY: 'proxy' },
  );
});

// Docker Desktop inspect ID может быть OCI index; scanner возвращает digest config bytes.
test('image archive identity uses config bytes and rejects ambiguous manifests', () => {
  const { archiveConfigId } = require('../image-release/scan.cjs');
  const { createHash } = require('node:crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-image-'));
  try {
    const config = '{"architecture":"arm64"}';
    const hash = createHash('sha256').update(config).digest('hex');
    fs.writeFileSync(path.join(root, hash + '.json'), config);
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify([{ Config: hash + '.json' }]),
    );
    const archive = path.join(root, 'image.tar');
    execFileSync('tar', ['-cf', archive, '-C', root, 'manifest.json', hash + '.json']);
    assert.equal(archiveConfigId(archive), 'sha256:' + hash);
    fs.writeFileSync(path.join(root, 'manifest.json'), '[{"Config":"../../outside"}]');
    execFileSync('tar', ['-cf', archive, '-C', root, 'manifest.json']);
    assert.throws(() => archiveConfigId(archive));
    fs.writeFileSync(path.join(root, 'manifest.json'), '[{},{}]');
    execFileSync('tar', ['-cf', archive, '-C', root, 'manifest.json']);
    assert.throws(() => archiveConfigId(archive));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Проверяем реальный YAML: PR не получает registry write, publisher не выполняет candidate source.
test('release workflows isolate publication from untrusted validation', () => {
  const yaml = require('node:module').createRequire(require.resolve('@asyncapi/parser'))('js-yaml');
  const read = (name) =>
    yaml.load(fs.readFileSync(path.join(__dirname, '../../.github/workflows', name), 'utf8'));
  const validation = read('validate.yaml');
  const release = read('release-images.yaml');
  assert.deepEqual(Object.keys(validation.on).sort(), ['pull_request', 'workflow_call']);
  assert.deepEqual(validation.permissions, { contents: 'read' });
  assert.equal(validation.jobs.validate.permissions, undefined);
  const commands = validation.jobs.validate.steps.map((s) => s.run || '').join('\n');
  for (const phase of ['harness:plan', 'harness:run', 'harness:ready'])
    assert.ok(commands.includes(phase));
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.ok(release.jobs.validate.if.includes('default_branch'));
  assert.equal(release.jobs.publish.needs, 'validate');
  assert.equal(release.jobs.publish.environment, 'ghcr-release');
  assert.deepEqual(release.jobs.publish.permissions, { contents: 'read', packages: 'write' });
  const publishSteps = release.jobs.publish.steps;
  assert.ok(!publishSteps.some((s) => s.uses?.startsWith('actions/checkout')));
  const publish = publishSteps.map((s) => s.run || '').join('\n');
  assert.ok(publish.includes('sha256sum --check SHA256SUMS'));
  assert.ok(publish.includes('docker pull "$canonical"'));
  assert.ok(publish.includes('GITHUB_RUN_ATTEMPT'));
  assert.ok(!publish.includes('docker build'));
  for (const workflow of [validation, release])
    for (const job of Object.values(workflow.jobs))
      for (const step of job.steps || []) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
});

// Закрепляем content baseline после переписывания commit metadata, без продвижения release content.
test('release checkpoint retains the accepted WMS-506 tree', () => {
  const root = path.resolve(__dirname, '../..');
  const base = require('./compatibility.cjs').releaseBase(root);
  assert.equal(
    execFileSync('git', ['rev-parse', base + '^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    '60460890ad2d9a91ec48d740da7ed2cbe18473f0',
  );
});

// Адресное исключение нельзя применить к другому пакету/version/OS, новому риску или после срока.
test('runtime policy rejects unrelated expired and altered advisory exceptions', () => {
  const { validateReport, validateExceptions } = require('../image-release/policy.cjs');
  const { runtimeBase, nodeVersion } = require('../image-release/runtime.cjs');
  const exceptions = require('../image-release/exceptions.json');
  const now = Date.parse('2026-11-20T00:00:00Z');
  const imageId = 'sha256:' + 'c'.repeat(64);
  const proof = {
    base: runtimeBase,
    nodeVersion,
    jsOnly: true,
    toolingAbsent: true,
    sharedOpenSSL: false,
  };
  const report = () => ({
    SchemaVersion: 2,
    ArtifactType: 'container_image',
    Metadata: { ImageID: imageId, OS: { Family: 'debian', Name: '13.7' } },
    Results: [
      {
        Target: 'Debian',
        Class: 'os-pkgs',
        Type: 'debian',
        Vulnerabilities: exceptions.map((e) => ({
          VulnerabilityID: e.id,
          PkgName: e.package,
          InstalledVersion: e.version,
          Severity: e.severity,
          Status: e.status,
        })),
      },
    ],
  });
  const options = { exceptions, proof, now };
  assert.equal(validateReport(report(), imageId, options).waived.length, 5);
  for (const mutate of [
    (r) => {
      r.Results[0].Vulnerabilities[0].PkgName += '-other';
    },
    (r) => {
      r.Results[0].Vulnerabilities[0].InstalledVersion += '1';
    },
    (r) => {
      r.Results[0].Vulnerabilities[0].Severity = 'HIGH';
    },
    (r) => {
      r.Results[0].Vulnerabilities[0].Status = 'fixed';
    },
    (r) => {
      r.Results[0].Vulnerabilities[0].FixedVersion = 'next';
    },
    (r) => {
      r.Results[0].Vulnerabilities[0].VulnerabilityID = 'CVE-2026-9999999';
    },
    (r) => {
      r.Results[0].Type = 'node-pkg';
    },
    (r) => {
      r.Metadata.OS.Name = '12.15';
    },
  ]) {
    const candidate = report();
    mutate(candidate);
    assert.throws(() => validateReport(candidate, imageId, options));
  }
  for (const badProof of [
    undefined,
    { ...proof, base: 'other' },
    { ...proof, jsOnly: false },
    { ...proof, toolingAbsent: false },
    { ...proof, sharedOpenSSL: true },
  ])
    assert.throws(() => validateReport(report(), imageId, { ...options, proof: badProof }));
  assert.throws(() =>
    validateReport(report(), imageId, { ...options, now: Date.parse('2026-12-20T00:00:00Z') }),
  );
  for (const mutate of [
    (e) => {
      e[0].reason = '';
    },
    (e) => {
      e[0].severity = 'HIGH';
    },
    (e) => {
      e[0].source = 'https://unreviewed.example';
    },
    (e) => {
      e[0].expires = 'invalid';
    },
    (e) => {
      e.push(e[0]);
    },
  ]) {
    const candidate = structuredClone(exceptions);
    mutate(candidate);
    assert.throws(() => validateExceptions(candidate, now));
  }
});
