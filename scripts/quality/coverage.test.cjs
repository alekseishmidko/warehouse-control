/** @file Guard не принимает падение branch coverage, исчезнувший source или новую непроверенную запись. */
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { compareCoverage } = require('./coverage.cjs');
const values = { lines: 90, statements: 90, functions: 100, branches: 90 };
test('ratchet принимает прежние/улучшенные метрики, отклоняет снижение и потерю файла', () => {
  const baseline = { 'src/a.ts': values };
  assert.deepEqual(compareCoverage(baseline, baseline), []);
  assert.equal(compareCoverage({ 'src/a.ts': { ...values, branches: 89 } }, baseline).length, 1);
  assert.equal(compareCoverage({}, baseline).length, 1);
  assert.equal(compareCoverage({ ...baseline, 'src/b.ts': values }, baseline).length, 1);
});

test('missing/non-numeric coverage cannot silently pass the guard', () => {
  const baseline = { 'src/a.ts': values };
  assert.ok(compareCoverage({ 'src/a.ts': { ...values, branches: null } }, baseline).length);
  assert.ok(compareCoverage({ 'src/a.ts': {} }, baseline).length);
  assert.ok(compareCoverage(baseline, {}).length);
});
