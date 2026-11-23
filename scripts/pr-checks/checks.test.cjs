/** @file WMS-601: disposable fixtures доказывают отказы docs/compatibility/frozen install и остановку настоящего runner. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { checkDocumentation, linkErrors, publicDocErrors, anchors } = require('./documentation.cjs');
const { compareRelease, assertApiCompatible } = require('./compatibility.cjs');

// Linux Node stdin является socket: его повторное открытие как /dev/stdin даёт ENXIO.
test('SOPS encryption uses stdin without reopening the child descriptor', () => {
  const { prepareSecrets } = require('../gitops/secrets.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-sops-stdin-'));
  const encryptedInputObserved = new Error('Encryption input observed');
  try {
    const session = {
      directory,
      namespace: 'warehouse-dev',
      run(binary, args, input) {
        if (binary === 'fixture-age-keygen') {
          if (args[0] === '-o') fs.writeFileSync(args[1], 'synthetic-key');
          return 'synthetic-recipient';
        }
        assert.equal(binary, 'fixture-sops');
        assert.ok(!args.includes('/dev/stdin'), 'Do not reopen the Node stdin socket');
        assert.equal(
          args[args.indexOf('--filename-override') + 1],
          path.join(directory, 'secrets.json'),
        );
        assert.equal(args[args.indexOf('--config') + 1], path.join(directory, 'sops-config.json'));
        assert.equal(args.at(-1), path.join(directory, 'secrets.json'));
        assert.equal(args[args.indexOf('--encrypted-regex') + 1], '^(data|stringData)$');
        const document = JSON.parse(input);
        assert.equal(document.kind, 'List');
        assert.equal(document.items.length, 3);
        assert.ok(document.items.every((item) => item.kind === 'Secret' && item.stringData));
        // Прерываем fixture до decrypt/apply: этот тест проверяет только контракт stdin adapter.
        throw encryptedInputObserved;
      },
    };
    assert.throws(
      () => prepareSecrets(session, { ageKeygen: 'fixture-age-keygen', sops: 'fixture-sops' }),
      (error) => error === encryptedInputObserved,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Реальный Helm проверяет chart; внешние Docker/kind заменены до создания ресурсов.
test('local image without RepoDigests reaches kind after real Helm validation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-local-image-'));
  try {
    const calls = path.join(directory, 'calls.jsonl');
    const executable = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify([command, ...args]) + '\\n');
if (command === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
  console.log(JSON.stringify([{ RepoDigests: [] }]));
} else if (command === 'docker' && ['build', 'pull', 'tag'].includes(args[0])) {
} else if (command === 'kind' && args[0] === 'create') {
  console.error('intentional fixture stop before cluster creation');
  process.exitCode = 1;
} else if (command === 'kind' && args[0] === 'delete') {
} else if (command === 'kubectl') {
  console.log(JSON.stringify({ items: [] }));
} else {
  process.exitCode = 3;
}
`;
    for (const name of ['docker', 'kind', 'kubectl'])
      fs.writeFileSync(path.join(directory, name), executable, { mode: 0o700 });
    const result = spawnSync(process.execPath, ['scripts/kubernetes-gate.cjs'], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        PATH: directory + path.delimiter + process.env.PATH,
        WMS_HELM: require('./helm.cjs').helmBinary(),
        WMS_KIND: path.join(directory, 'kind'),
        WMS_KUBECTL: path.join(directory, 'kubectl'),
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /PASS chart lint\/template: one digest, Secret references only/);
    assert.match(result.stderr, /intentional fixture stop before cluster creation/);
    const commands = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(commands.some(([command, action]) => command === 'kind' && action === 'create'));
    assert.ok(commands.some(([command, action]) => command === 'kind' && action === 'delete'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
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
  assert.equal(validation.jobs.validate['runs-on'], 'ubuntu-24.04-arm');
  assert.equal(release.jobs.publish['runs-on'], 'ubuntu-24.04-arm');
  assert.deepEqual(validation.permissions, { contents: 'read' });
  assert.equal(validation.jobs.validate.permissions, undefined);
  const commands = validation.jobs.validate.steps.map((s) => s.run || '').join('\n');
  assert.ok(commands.includes('node scripts/image-release/export.cjs'));
  assert.ok(!commands.includes('docker save -o artifacts/release'));
  assert.ok(release.jobs.publish.outputs['backend-config']);
  for (const phase of ['harness:plan', 'harness:run', 'harness:ready'])
    assert.ok(commands.includes(phase));
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.ok(release.jobs.validate.if.includes('default_branch'));
  assert.equal(release.jobs.publish.needs, 'validate');
  assert.equal(release.jobs.publish.environment, 'ghcr-release');
  assert.equal(release.jobs['verify-pull'].needs, 'publish');
  assert.equal(release.jobs['verify-pull']['runs-on'], 'ubuntu-24.04-arm');
  assert.deepEqual(release.jobs['verify-pull'].permissions, { contents: 'read', packages: 'read' });
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
    systemOpenSSLAbsent: true,
  };
  const report = () => ({
    SchemaVersion: 2,
    ArtifactType: 'container_image',
    Metadata: { ImageID: imageId, OS: { Family: 'debian', Name: exceptions[0].osVersion } },
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
  assert.equal(validateReport(report(), imageId, options).waived.length, exceptions.length);
  // Iconv advisory допускается только в точной reviewed области; FixedVersion/HIGH её отменяют.
  const iconvReport = report();
  iconvReport.Results[0].Vulnerabilities = [
    {
      VulnerabilityID: 'CVE-2026-121757',
      PkgName: 'libc6',
      InstalledVersion: exceptions[0].version,
      Severity: 'UNKNOWN',
      Status: 'affected',
    },
  ];
  assert.deepEqual(validateReport(iconvReport, imageId, options).waived, [
    { id: 'CVE-2026-121757', package: 'libc6', expires: '2026-12-20' },
  ]);
  for (const change of [{ FixedVersion: 'next' }, { Severity: 'HIGH' }]) {
    const candidate = structuredClone(iconvReport);
    Object.assign(candidate.Results[0].Vulnerabilities[0], change);
    assert.throws(() => validateReport(candidate, imageId, options));
  }
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
    { ...proof, systemOpenSSLAbsent: false },
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

// Target pull принимает только согласованный GHCR repository и digest, без mutable tag/чужих images.
test('target pull rejects tags foreign repositories and malformed digests', () => {
  const { parseReleaseRef } = require('../image-release/pull-kind.cjs');
  const repository = 'alekseishmidko/warehouse-control';
  const ref = 'ghcr.io/' + repository + '/backend@sha256:' + 'a'.repeat(64);
  assert.equal(parseReleaseRef(ref, repository, 'backend'), ref);
  for (const candidate of [
    ref.replace('@sha256:', ':'),
    ref + ';echo bad',
    ref.replace('/backend', '/web'),
    ref.replace('warehouse-control', 'other'),
    undefined,
  ])
    assert.throws(() => parseReleaseRef(candidate, repository, 'backend'));
});

// Реальные tar/config bytes и filesystem; Docker boundary подменяет только inspect/save для детерминированной гонки.
test('checked image export rejects changed tags and archive contents', async () => {
  const { exportCheckedImages } = require('../image-release/export.cjs');
  const { createHash } = require('node:crypto');
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const commit = 'a'.repeat(40);
  for (const mode of ['tag-changed', 'save-race', 'report-changed', 'success']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-export-'));
    try {
      const dir = path.join(root, 'artifacts/image-scan/example');
      fs.mkdirSync(dir, { recursive: true });
      const makeArchive = (label) => {
        const config = JSON.stringify({ architecture: 'arm64', label });
        const digest = hash(config);
        fs.writeFileSync(path.join(dir, digest + '.json'), config);
        fs.writeFileSync(
          path.join(dir, 'manifest.json'),
          JSON.stringify([{ Config: digest + '.json' }]),
        );
        const archive = path.join(dir, label + '.tar');
        execFileSync('tar', ['-cf', archive, '-C', dir, 'manifest.json', digest + '.json']);
        return { archive, configId: 'sha256:' + digest };
      };
      const original = makeArchive('original'),
        different = makeArchive('changed');
      const images = ['backend', 'web'].map((app) => {
        const report = JSON.stringify({
          SchemaVersion: 2,
          ArtifactType: 'container_image',
          Metadata: { ImageID: original.configId },
          Results: [{ Target: 'Debian', Class: 'os-pkgs', Type: 'debian' }],
        });
        fs.writeFileSync(path.join(dir, app + '.json'), report);
        return {
          app,
          imageId: original.configId,
          configId: original.configId,
          reportSha256: hash(report),
        };
      });
      fs.writeFileSync(
        path.join(dir, 'summary.json'),
        JSON.stringify({ status: 'passed', commit, images }),
      );
      const run = '00000000-0000-4000-8000-000000000000';
      const harness = path.join(root, 'artifacts/harness/wms-602');
      fs.mkdirSync(path.join(harness, run), { recursive: true });
      const log = 'Image scan evidence: ' + path.join(dir, 'summary.json') + '\n';
      fs.writeFileSync(path.join(harness, run, 'imageScan.log'), log);
      fs.writeFileSync(
        path.join(harness, 'latest.json'),
        JSON.stringify({
          status: 'passed',
          run,
          results: [{ id: 'imageScan', code: 0, logHash: hash(log) }],
        }),
      );
      if (mode === 'report-changed') fs.appendFileSync(path.join(dir, 'backend.json'), ' ');
      let saves = 0;
      const docker = (args) => {
        if (args[1] === 'inspect')
          return (mode === 'tag-changed' ? different.configId : original.configId) + '\n';
        assert.equal(args[1], 'save');
        saves++;
        fs.copyFileSync(mode === 'save-race' ? different.archive : original.archive, args[3]);
        return '';
      };
      const file = path.join(root, 'artifacts/release/export-evidence.json');
      if (mode === 'success') {
        const result = await exportCheckedImages(root, commit, docker);
        assert.equal(saves, 2);
        assert.equal(result.images.length, 2);
        assert.equal(result.images[0].configId, original.configId);
        assert.equal(JSON.parse(fs.readFileSync(file)).commit, commit);
      } else {
        await assert.rejects(exportCheckedImages(root, commit, docker), /changed|differs/);
        assert.equal(fs.existsSync(file), false);
        assert.equal(fs.existsSync(path.join(root, 'artifacts/release/backend.tar')), false);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

// Реальный Helm render: default hooks сохранены, Argo migration не обгоняет SA и блокирует wave0.
test('GitOps migration ordering preserves the default Helm contract', () => {
  const { helmBinary } = require('./helm.cjs');
  const yaml = require('node:module').createRequire(require.resolve('@asyncapi/parser'))('js-yaml');
  const args = [
    'template',
    'gitops-check',
    path.resolve(__dirname, '../../infra/helm/warehouse'),
    '--set-string',
    'image.digest=sha256:' + 'a'.repeat(64),
    '--set-string',
    'database.runtimeSecret=runtime',
    '--set-string',
    'database.migrationSecret=migration',
    '--set-string',
    'auth.origin=https://warehouse.local',
    '--set-string',
    'auth.absoluteSeconds=600',
    '--set-string',
    'auth.idleSeconds=300',
  ];
  const render = (extra = []) =>
    yaml.loadAll(
      execFileSync(helmBinary(), [...args, ...extra], { encoding: 'utf8', stdio: 'pipe' }),
    );
  const regular = render().find((r) => r?.kind === 'Job');
  assert.equal(regular.metadata.annotations['helm.sh/hook'], 'pre-install,pre-upgrade');
  assert.match(regular.metadata.name, /-migrate-1$/);
  const argo = render(['--set', 'deployment.controller=argocd']);
  const job = argo.find((r) => r?.kind === 'Job');
  assert.equal(job.metadata.name, 'gitops-check-migrate');
  assert.equal(job.metadata.annotations['argocd.argoproj.io/hook'], 'Sync');
  assert.equal(job.metadata.annotations['argocd.argoproj.io/sync-wave'], '-1');
  assert.equal(
    job.metadata.annotations['argocd.argoproj.io/hook-delete-policy'],
    'BeforeHookCreation',
  );
  assert.equal(job.metadata.annotations['helm.sh/hook'], undefined);
  const account = argo.find(
    (r) =>
      r?.kind === 'ServiceAccount' && r.metadata.name === job.spec.template.spec.serviceAccountName,
  );
  assert.equal(account.metadata.annotations['argocd.argoproj.io/sync-wave'], '-2');
  assert.equal(account.automountServiceAccountToken, false);
  assert.equal(job.spec.backoffLimit, 0);
  assert.equal(job.spec.activeDeadlineSeconds, 180);
  for (const deployment of argo.filter((r) => r?.kind === 'Deployment'))
    assert.equal(deployment.metadata.annotations?.['argocd.argoproj.io/sync-wave'] ?? '0', '0');
  assert.throws(() => render(['--set', 'deployment.controller=unknown']), /Command failed/);
});

// Недоверенная revision/artifact policy не может выбрать mutable source или credential URL.
test('GitOps policy rejects mutable revisions foreign imports and unsafe artifacts', async () => {
  const { application } = require('../gitops/application.cjs');
  const { pinnedCore } = require('../gitops/core.cjs');
  const { importCheckedImage } = require('../gitops/import.cjs');
  const { checkedDownload, hash } = require('../gitops/tools.cjs');
  for (const value of ['main', 'latest', 'a'.repeat(39), 'a'.repeat(40) + ';bad'])
    assert.throws(() => application(value), /Exact Git revision/);
  assert.equal(application('a'.repeat(40)).spec.destination.namespace, 'warehouse-dev');
  assert.throws(() => pinnedCore('tampered vendor manifest'), /checksum/);
  assert.throws(
    () => importCheckedImage({ cluster: 'owned' }, 'user-project:latest', 'probe'),
    /owned/,
  );
  assert.throws(() =>
    importCheckedImage({ cluster: 'owned' }, 'warehouse-vendor:owned-0', '../outside'),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitops-policy-'));
  try {
    const file = path.join(root, 'artifact');
    fs.writeFileSync(file, 'verified bytes');
    assert.equal(
      await checkedDownload(
        { url: 'https://invalid.example/artifact', sha256: hash(fs.readFileSync(file)) },
        file,
      ),
      file,
    );
    for (const url of [
      'http://invalid.example/file',
      'https://user:password@invalid.example/file',
      'https://invalid.example/file?token=credential',
    ])
      await assert.rejects(
        checkedDownload({ url, sha256: hash(fs.readFileSync(file)) }, file),
        /Invalid pinned artifact/,
      );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Ошибка ownership запрещает удаление чужого image, но не препятствует освобождению своего private directory.
test('GitOps cleanup rejects foreign images and still removes private files', async () => {
  const { createSession } = require('../gitops/session.cjs');
  const before = process.listenerCount('SIGTERM');
  const session = createSession({ kind: 'unavailable-kind', kubectl: 'unavailable-kubectl' });
  fs.writeFileSync(path.join(session.directory, 'private-marker'), 'synthetic');
  session.ownedImages.push('user-project:latest');
  await assert.rejects(session.close(), /Foreign image cleanup rejected/);
  assert.equal(fs.existsSync(session.directory), false);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

// Запускается фактический container program под ESM. HTTP adapter stub не реализует складскую логику; integration gate делает реальные команды.
test('rolling load program starts as ESM and stops without leaking request credentials', () => {
  const { loadProgram } = require('../gitops/load.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-module-'));
  try {
    const stop = path.join(root, 'wms-load-stop');
    const stub = `globalThis.fetch=async(url)=>{if(url.endsWith('/post')){(await import('node:fs')).writeFileSync(${JSON.stringify(stop)},'stop');return {status:200,json:async()=>({})};}return {status:201,json:async()=>({id:'synthetic-receipt'})};};\n`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', stub + loadProgram], {
      input: JSON.stringify({
        auth: { Cookie: 'synthetic-private-cookie' },
        fixture: {
          warehouseId: 'synthetic',
          receivingLocationId: 'synthetic',
          productId: 'synthetic',
        },
        progressDirectory: root,
      }),
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.posted, 1);
    assert.equal(summary.failures, 0);
    assert.equal(summary.stopped, true);
    assert.ok(!result.stdout.includes('synthetic-private-cookie'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('registry pull config binding rejects changed or incomplete CRI metadata', () => {
  const { assertPulledConfig } = require('../image-release/pull-kind.cjs');
  const id = 'sha256:' + 'd'.repeat(64);
  const ref = 'ghcr.io/alekseishmidko/warehouse-control/backend@sha256:' + 'e'.repeat(64);
  assert.doesNotThrow(() => assertPulledConfig({ id, repoDigests: [ref] }, ref, id));
  for (const image of [
    {},
    { id, repoDigests: [] },
    { id: 'sha256:' + 'f'.repeat(64), repoDigests: [ref] },
  ])
    assert.throws(() => assertPulledConfig(image, ref, id));
});

test('release rehearsal preserves rollback profiles and rejects unsafe SQL identifiers', () => {
  const { withImage } = require('../gitops/platform.cjs');
  const { databaseFacts } = require('../gitops/backup.cjs');
  const baseline = { image: { digest: 'before' }, auth: { origin: 'https://warehouse.local' } };
  const candidate = withImage(baseline, {
    repository: 'fixture',
    digest: 'after',
    pullPolicy: 'Never',
  });
  candidate.auth.origin = 'https://changed.local';
  assert.equal(baseline.auth.origin, 'https://warehouse.local');
  assert.equal(baseline.image.digest, 'before');
  const session = {
    sql: () => {
      throw Error('SQL must not run');
    },
  };
  assert.throws(() => databaseFacts(session, 'warehouse;drop database warehouse'), /match/);
  assert.throws(
    () => databaseFacts(session, 'warehouse', ['stock_movements;drop table users']),
    /match/,
  );
});

// Exact old git diff guard игнорировал новый runtime source без git add. Проверяем actual Git, не mock output.
test('accepted runtime guard rejects untracked build inputs but permits test-only changes', () => {
  const { verifyRuntimeSource, runtimeSourceSnapshot } = require('../gitops/runtime-source.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-source-'));
  const git = (args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Synthetic',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' },
    ).trim();
  try {
    fs.mkdirSync(path.join(root, 'apps/backend/src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/backend/src/main.ts'), 'checked source');
    git(['init']);
    git(['add', '.']);
    git(['commit', '-m', 'checked']);
    const base = runtimeSourceSnapshot(root);
    assert.doesNotThrow(() => verifyRuntimeSource(base, root));
    const added = path.join(root, 'apps/backend/src/added.ts');
    fs.writeFileSync(added, 'untracked build input');
    assert.throws(() => verifyRuntimeSource(base, root), /Runtime source changed/);
    fs.writeFileSync(path.join(root, '.gitignore'), 'apps/backend/src/added.ts\n');
    assert.throws(() => verifyRuntimeSource(base, root), /Runtime source changed/);
    fs.rmSync(added);
    fs.mkdirSync(path.join(root, 'apps/backend/test'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/backend/test/fixture.spec.ts'), 'test-only change');
    assert.doesNotThrow(() => verifyRuntimeSource(base, root));
    fs.writeFileSync(path.join(root, 'apps/backend/src/main.ts'), 'changed build input');
    assert.throws(() => verifyRuntimeSource(base, root), /Runtime source changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Фактический filesystem payload: сохраняем SONAME links/metadata, не переносим SSL package и не принимаем traversal.
test('minimal runtime assembly preserves package metadata and rejects unsafe inventory', () => {
  const { copyCppRuntime } = require('../image-release/cpp-runtime.cjs');
  const { createHash } = require('node:crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-runtime-'));
  const source = path.join(root, 'source'),
    output = path.join(root, 'output');
  const write = (name, bytes) => {
    const p = path.join(source, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  };
  try {
    const inventory = {
      'gcc-14-base': 'usr/share/doc/gcc-14-base/copyright',
      'libgcc-s1': 'usr/lib/aarch64-linux-gnu/libgcc_s.so.1',
      'libstdc++6': 'usr/lib/aarch64-linux-gnu/libstdc++.so.6.0.33',
    };
    for (const [name, file] of Object.entries(inventory)) {
      const bytes = 'synthetic package ' + name;
      write(file, bytes);
      write('var/lib/dpkg/status.d/' + name, 'Package: ' + name + '\nVersion: checked\n');
      write(
        'var/lib/dpkg/status.d/' + name + '.md5sums',
        createHash('md5').update(bytes).digest('hex') + '  ' + file + '\n',
      );
    }
    fs.symlinkSync(
      'libstdc++.so.6.0.33',
      path.join(source, 'usr/lib/aarch64-linux-gnu/libstdc++.so.6'),
    );
    write('usr/lib/aarch64-linux-gnu/libssl.so.3', 'must not transfer');
    copyCppRuntime(source, output, 'arm64');
    assert.equal(
      fs.readlinkSync(path.join(output, 'usr/lib/aarch64-linux-gnu/libstdc++.so.6')),
      'libstdc++.so.6.0.33',
    );
    for (const name of Object.keys(inventory))
      assert.ok(fs.existsSync(path.join(output, 'var/lib/dpkg/status.d/' + name)));
    assert.equal(fs.existsSync(path.join(output, 'usr/lib/aarch64-linux-gnu/libssl.so.3')), false);
    write('var/lib/dpkg/status.d/libgcc-s1.md5sums', 'a'.repeat(32) + '  ../outside\n');
    assert.throws(
      () => copyCppRuntime(source, path.join(root, 'unsafe'), 'arm64'),
      /Unsafe package inventory/,
    );
    assert.throws(
      () => copyCppRuntime(source, path.join(root, 'wrong-arch'), 's390x'),
      /Unsupported/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
