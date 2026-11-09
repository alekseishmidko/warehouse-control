/** @file Security/compat regression реальных dev consumers: deepmerge poisoning, archiver glob и esbuild CORS. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { join, dirname, resolve } = require('node:path');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const backend = createRequire(resolve('apps/backend/package.json'));
const jestRequire = createRequire(
  createRequire(createRequire(backend.resolve('jest')).resolve('@jest/core')).resolve(
    'jest-config',
  ),
);
const checker = createRequire(
  createRequire(backend.resolve('@nestjs/cli/package.json')).resolve(
    'fork-ts-checker-webpack-plugin',
  ),
);
/** Оба настоящих consumer должны получить исправленный package, а не отдельно протестированный shim. */
test('AC-R04-01: Jest/CLI merge rejects poisoned source and target prototypes', () => {
  assert.equal(jestRequire.resolve('deepmerge'), checker.resolve('deepmerge'));
  const main = jestRequire.resolve('deepmerge');
  for (const merge of [jestRequire('deepmerge'), require(join(dirname(main), 'umd.js'))]) {
    const poison = () =>
      JSON.parse(
        '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}},"prototype":{"isAdmin":true}}',
      );
    for (const result of [
      merge(Object.create(null), poison()),
      merge(null, poison()),
      merge(0, poison()),
      merge(poison(), {}),
      merge({ nested: Object.create(null) }, { nested: poison() }).nested,
    ]) {
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.isAdmin, undefined);
      assert.equal(Object.hasOwn(result, '__proto__'), false);
      assert.equal(Object.hasOwn(result, 'constructor'), false);
      assert.equal(Object.hasOwn(result, 'prototype'), false);
    }
    assert.equal(Object.prototype.isAdmin, undefined);
    // Jest пользуется как merge(), так и .all(); массивы/обычные nested globals сохраняют прежний смысл.
    assert.deepEqual(
      merge.all([
        { globals: { left: 1 }, list: [1] },
        { globals: { right: 2 }, list: [2] },
      ]),
      { globals: { left: 1, right: 2 }, list: [1, 2] },
    );
    assert.deepEqual(
      merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target, source) => source }),
      { list: [2] },
    );
  }
});

test('AC-R04-02: Testcontainers archiver glob keeps recursive include/exclude behavior', async () => {
  const containers = createRequire(
    createRequire(backend.resolve('@testcontainers/postgresql')).resolve('testcontainers'),
  );
  const archiver = createRequire(containers.resolve('archiver'));
  const utils = archiver('archiver-utils');
  const directory = await mkdtemp(join(tmpdir(), 'wms-glob-'));
  try {
    await mkdir(join(directory, 'nested'));
    await writeFile(join(directory, 'a.txt'), 'a');
    await writeFile(join(directory, 'ignored.txt'), 'ignored');
    await writeFile(join(directory, 'nested/b.txt'), 'b');
    assert.deepEqual(utils.file.expand({ cwd: directory }, ['**/*.txt', '!ignored.txt']).sort(), [
      'a.txt',
      'nested/b.txt',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AC-R04-02: Drizzle loader esbuild transforms TS and does not expose wildcard CORS', async () => {
  const loader = createRequire(
    createRequire(backend.resolve('drizzle-kit')).resolve('@esbuild-kit/esm-loader'),
  );
  const core = createRequire(loader.resolve('@esbuild-kit/core-utils'));
  const esbuild = core('esbuild');
  const directory = await mkdtemp(join(tmpdir(), 'wms-esbuild-'));
  let context;
  try {
    await writeFile(join(directory, 'entry.ts'), 'export const answer: number = 42;');
    await writeFile(join(directory, 'public.txt'), 'synthetic internal content');
    context = await esbuild.context({
      entryPoints: [join(directory, 'entry.ts')],
      outdir: join(directory, 'out'),
      bundle: true,
    });
    const { port } = await context.serve({ host: '127.0.0.1', port: 0, servedir: directory });
    const response = await fetch(`http://127.0.0.1:${port}/public.txt`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    await response.text();
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
    const built = await esbuild.transform('const answer: number = 42;', { loader: 'ts' });
    assert.ok(built.code.includes('answer = 42'));
  } finally {
    await context?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
