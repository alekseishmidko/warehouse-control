/** @file Проверка k6 evidence независимо от exit code: завершённые итерации и бизнес-счётчики не расходятся. */
const assert = require('node:assert/strict');
const { budget } = require('./config.cjs');
/** Throughput задаётся rate/duration, а не точным числом итераций: граничный tick k6 может дать 501 вместо 500.
 * Точность фиксированного backlog сохраняется. Любой неполный HTTP pair или error/dropped iteration — отказ. */
function validateSummary(summary, scenario) {
  const metrics = summary.metrics;
  assert.equal(metrics.unexpected_responses?.values.rate, 0, 'unexpected HTTP response');
  assert.equal(metrics.http_req_failed?.values.rate, 0, 'failed HTTP request');
  assert.equal(metrics.dropped_iterations?.values.count ?? 0, 0, 'dropped iteration');
  const iterations = metrics.iterations?.values.count;
  assert.ok(Number.isSafeInteger(iterations) && iterations > 0, 'completed k6 iterations');
  if (scenario === 'sku') {
    assert.equal(iterations, budget.vus, 'one reservation per VU');
    assert.equal(metrics.reserve_successes?.values.count, 1, 'one reservation winner');
    assert.equal(
      metrics.reserve_conflicts?.values.count,
      budget.vus - 1,
      'all losers reject shortage',
    );
    assert.equal(metrics.http_reqs?.values.count, iterations, 'one HTTP reserve per iteration');
  } else {
    assert.equal(metrics.receipts_posted?.values.count, iterations, 'all receipt pairs complete');
    assert.equal(metrics.http_reqs?.values.count, iterations * 2, 'two HTTP requests per receipt');
    if (scenario === 'backlog')
      assert.equal(iterations, budget.vus * budget.backlogIterationsPerVu, 'fixed backlog dataset');
    else {
      assert.ok(
        summary.state.testRunDurationMs >= budget.throughputSeconds * 1000,
        'complete scheduled duration',
      );
      const scheduled = budget.throughputReceiptsPerSecond * budget.throughputSeconds;
      assert.ok(
        iterations >= scheduled && iterations <= scheduled + 1,
        'scheduled arrivals including optional boundary tick',
      );
    }
  }
}
/** Публичный artifact не принимает capabilities или raw payload. Проверяется и success, и failure evidence. */
function assertPublicEvidence(value, secrets = []) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets)
    if (secret) assert.ok(!serialized.includes(secret), 'secret in load evidence');
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.ok(
        !/^(password|cookie|csrfToken|authorization|databaseUrl|connectionString|headers|payload|body|diagnostic)$/i.test(
          key,
        ),
        'private field in load evidence',
      );
      visit(child);
    }
  }
  visit(value);
}
module.exports = { validateSummary, assertPublicEvidence };
