/** @file Regression tests guardrails и измерений load harness; SQL/business evidence даёт реальный load:baseline. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectScenarios, assertLocalDockerEndpoint, budget } = require('./config.cjs');
const { validateSummary, assertPublicEvidence } = require('./results.cjs');
const { assertReconciled } = require('./reconcile.cjs');
const { startObserver, summarizeSamples, waitFor } = require('./observe.cjs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
/** Нулевая сверка — только fixture формы evidence, не копия warehouse алгоритма. */
function clean() {
  return {
    balance_errors: 0,
    ledger_errors: 0,
    allocation_errors: 0,
    duplicate_movements: 0,
    duplicate_tasks: 0,
    duplicate_markers: 0,
    receipt_errors: 0,
    unfinished_receipts: 0,
    unfinished_commands: 0,
    receipts: 2,
    movements: 2,
    on_hand: 2,
  };
}
test('load CLI rejects arbitrary destinations and unknown or extra arguments', () => {
  assert.deepEqual(selectScenarios(['baseline']), ['throughput', 'sku', 'backlog']);
  assert.deepEqual(selectScenarios(['sku']), ['sku']);
  for (const args of [
    [],
    ['http://example.com'],
    ['sku', '--url=outside'],
    ['baseline', 'throughput'],
  ])
    assert.throws(() => selectScenarios(args));
});
test('remote Docker endpoints are rejected before container creation', () => {
  assertLocalDockerEndpoint('unix:///var/run/docker.sock');
  for (const endpoint of ['ssh://server', 'tcp://192.0.2.1:2376', 'https://remote', ''])
    assert.throws(() => assertLocalDockerEndpoint(endpoint));
});
test('CLI rejection does not print credentials from a remote Docker endpoint', () => {
  const privateMarker = 'synthetic-private-docker-password';
  const child = spawnSync(process.execPath, [join(__dirname, 'run.cjs'), 'sku'], {
    env: { ...process.env, DOCKER_HOST: `ssh://synthetic-user:${privateMarker}@example.invalid` },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /local Unix Docker socket/);
  assert.ok(!child.stderr.includes(privateMarker), 'private endpoint leaked to stderr');
});
/** Synthetic evidence содержит только независимые итоговые счётчики, без копирования HTTP/stock алгоритмов. */
function receiptSummary(count = budget.throughputReceiptsPerSecond * budget.throughputSeconds + 1) {
  return {
    state: { testRunDurationMs: 20010 },
    metrics: {
      unexpected_responses: { values: { rate: 0 } },
      http_req_failed: { values: { rate: 0 } },
      iterations: { values: { count } },
      http_reqs: { values: { count: count * 2 } },
      receipts_posted: { values: { count } },
    },
  };
}
test('arrival-rate boundary tick is valid but incomplete receipt pairs and errors are rejected', () => {
  const planned = budget.throughputReceiptsPerSecond * budget.throughputSeconds;
  validateSummary(receiptSummary(planned), 'throughput');
  validateSummary(receiptSummary(planned + 1), 'throughput');
  assert.throws(() => validateSummary(receiptSummary(planned - 1), 'throughput'));
  assert.throws(() => validateSummary(receiptSummary(planned + 2), 'throughput'));
  for (const mutate of [
    (s) => {
      s.metrics.http_reqs.values.count--;
    },
    (s) => {
      s.metrics.receipts_posted.values.count--;
    },
    (s) => {
      s.metrics.unexpected_responses.values.rate = 0.01;
    },
    (s) => {
      s.metrics.http_req_failed.values.rate = 0.01;
    },
    (s) => {
      s.metrics.dropped_iterations = { values: { count: 1 } };
    },
    (s) => {
      s.state.testRunDurationMs = 500;
    },
  ]) {
    const s = receiptSummary();
    mutate(s);
    assert.throws(() => validateSummary(s, 'throughput'));
  }
  assert.throws(() => validateSummary(receiptSummary(99), 'backlog'));
  validateSummary(receiptSummary(100), 'backlog');
});
test('public evidence rejects nested capabilities and secret strings', () => {
  assertPublicEvidence({ metrics: { http_req_duration: { values: { 'p(99)': 12 } } } }, [
    'synthetic-secret',
  ]);
  for (const key of [
    'password',
    'Cookie',
    'csrfToken',
    'authorization',
    'databaseUrl',
    'connectionString',
    'headers',
    'payload',
    'body',
    'diagnostic',
  ]) {
    assert.throws(() => assertPublicEvidence({ nested: { [key]: 'value' } }));
  }
  assert.throws(() =>
    assertPublicEvidence({ nested: { note: 'synthetic-secret' } }, ['synthetic-secret']),
  );
});
test('business verification rejects every discrepancy independently, including missing evidence', () => {
  assertReconciled(clean(), { receipts: 2, movements: 2, on_hand: 2 });
  for (const key of [
    'balance_errors',
    'ledger_errors',
    'allocation_errors',
    'duplicate_movements',
    'duplicate_tasks',
    'duplicate_markers',
    'receipt_errors',
    'unfinished_receipts',
    'unfinished_commands',
  ]) {
    assert.throws(() => assertReconciled({ ...clean(), [key]: 1 }, {}), undefined, key);
    const missing = clean();
    delete missing[key];
    assert.throws(() => assertReconciled(missing, {}), undefined, key);
  }
  assert.throws(() => assertReconciled(clean(), { on_hand: 3 }));
});
test('sample aggregation retains contention/backlog and expected rollback delta', () => {
  const samples = [
    {
      elapsedMs: 0,
      lock_waiters: 0,
      blocked_query_age_ms: 0,
      pending: 1,
      processing: 0,
      retry: 0,
      oldest_age_seconds: 1,
      commits: 10,
      rollbacks: 0,
      deadlocks: 0,
    },
    {
      elapsedMs: 100,
      lock_waiters: 4,
      blocked_query_age_ms: 80,
      pending: 5,
      processing: 0,
      retry: 0,
      oldest_age_seconds: 2,
      commits: 12,
      rollbacks: 0,
      deadlocks: 0,
    },
    {
      elapsedMs: 250,
      lock_waiters: 0,
      blocked_query_age_ms: 0,
      pending: 0,
      processing: 0,
      retry: 0,
      oldest_age_seconds: 0,
      commits: 20,
      rollbacks: 3,
      deadlocks: 0,
    },
  ];
  assert.deepEqual(summarizeSamples(samples), {
    sampleCount: 3,
    observedMs: 250,
    maxLockWaiters: 4,
    sampledWaiterMs: 600,
    maxBlockedQueryAgeMs: 80,
    peakBacklog: 5,
    oldestAgeSeconds: 2,
    commitsDelta: 10,
    rollbacksDelta: 3,
    deadlocksDelta: 0,
  });
  assert.throws(() => summarizeSamples([]));
});
test('observer propagates query failure and does not leave an unhandled timer', async () => {
  const observer = startObserver({
    query: async () => {
      throw new Error('sample unavailable');
    },
  });
  await assert.rejects(observer.stop(), /sample unavailable/);
});
test('observer fails on dead delivery instead of reporting a successful drain', async () => {
  let cancelled = false;
  const observer = startObserver(
    {
      query: async () => ({
        rows: [{ pending: 0, processing: 0, retry: 0, dead: 1, deadlocks: 0 }],
      }),
    },
    async () => {
      cancelled = true;
    },
  );
  await assert.rejects(observer.stop(), /dead delivery/);
  assert.equal(cancelled, true, 'generator cancellation requested');
});
test('bounded condition reports timeout and propagates read errors', async () => {
  await assert.rejects(
    waitFor(async () => false, Boolean, 1, 'drain deadline'),
    /drain deadline/,
  );
  await assert.rejects(
    waitFor(
      async () => {
        throw new Error('query failure');
      },
      Boolean,
      100,
      'deadline',
    ),
    /query failure/,
  );
});
test('observer backlog guard requests cancellation without raising the ceiling', async () => {
  let cancelled = false;
  const observer = startObserver(
    {
      query: async () => ({
        rows: [
          { pending: budget.backlogCeiling + 1, processing: 0, retry: 0, dead: 0, deadlocks: 0 },
        ],
      }),
    },
    async () => {
      cancelled = true;
    },
  );
  await assert.rejects(observer.stop(), /backlog ceiling/);
  assert.equal(cancelled, true);
});
test('importing Docker transport does not start a Compose project', () => {
  const helper = require('../docker-gate.cjs');
  assert.equal(typeof helper.run, 'function');
  assert.equal(typeof helper.until, 'function');
});
test('cleanup retains primary failure and attempts all resources including secret deletion', async () => {
  const { cleanupResources } = require('./run.cjs');
  const primary = new Error('observer failure');
  const seen = [];
  const failures = await cleanupResources(
    [
      [
        'observer',
        async () => {
          seen.push('observer');
          throw primary;
        },
      ],
      [
        'application_project',
        async () => {
          seen.push('app');
          throw new Error('daemon failed');
        },
      ],
      [
        'monitoring_project',
        async () => {
          seen.push('monitoring');
        },
      ],
      [
        'secret_directory',
        async () => {
          seen.push('secrets');
        },
      ],
    ],
    primary,
  );
  assert.deepEqual(failures, ['application_project']);
  assert.deepEqual(seen, ['observer', 'app', 'monitoring', 'secrets']);
});

test('cancel during setup or settle prevents the next load operation', async () => {
  const { createCancellation } = require('./cancellation.cjs');
  const cancelled = createCancellation();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const setup = cancelled.run(() => barrier);
  cancelled.abort();
  release();
  await assert.rejects(setup);
  let launched = false;
  await assert.rejects(
    cancelled.run(async () => {
      launched = true;
    }),
  );
  assert.equal(launched, false);
  const settling = createCancellation();
  const wait = settling.wait(15000);
  settling.abort();
  await assert.rejects(wait);
  assert.throws(() => settling.check());
});
