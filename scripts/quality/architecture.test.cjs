/** @file Отрицательные проверки guard: запрещённый импорт/цикл действительно приводит к finding. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectGraph } = require('./architecture.cjs');
test('shared и private repositories проверяются даже для type-only импортов', () => {
  assert.equal(
    inspectGraph([{ from: 'shared/x.ts', to: 'modules/inventory/dto/x.ts', runtime: false }])
      .length,
    1,
  );
  assert.equal(
    inspectGraph([
      { from: 'modules/a/services/x.ts', to: 'modules/b/repositories/x.ts', runtime: false },
    ]).length,
    1,
  );
  assert.deepEqual(
    inspectGraph([
      { from: 'modules/a/services/x.ts', to: 'modules/a/repositories/x.ts', runtime: true },
    ]),
    [],
  );
});
test('runtime cycle блокируется; type-only и schema FK связи не дают ложный cycle', () => {
  const edges = [
    { from: 'modules/a.ts', to: 'modules/b.ts', runtime: true },
    { from: 'modules/b.ts', to: 'modules/a.ts', runtime: true },
  ];
  assert.match(inspectGraph(edges)[0], /runtime cycle/);
  assert.deepEqual(inspectGraph(edges.map((e) => ({ ...e, runtime: false }))), []);
  assert.deepEqual(
    inspectGraph([
      { from: 'a.schema.ts', to: 'b.schema.ts', runtime: true },
      { from: 'b.schema.ts', to: 'a.schema.ts', runtime: true },
    ]),
    [],
  );
});

test('TypeScript resolver проверяет реальный импорт, включая alias и export type', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const { checkArchitecture } = require('./architecture.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-architecture-'));
  try {
    fs.mkdirSync(path.join(root, 'src/shared'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src/modules/a/repositories'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@backend/*': ['src/*'] } } }),
    );
    fs.writeFileSync(path.join(root, 'src/modules/a/repositories/a.ts'), 'export const value = 1;');
    fs.writeFileSync(
      path.join(root, 'src/shared/a.ts'),
      "export {value} from '@backend/modules/a/repositories/a';",
    );
    const errors = checkArchitecture(root);
    assert.ok(errors.some((e) => e.startsWith('shared boundary:')));
    assert.ok(errors.some((e) => e.startsWith('private repository:')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
