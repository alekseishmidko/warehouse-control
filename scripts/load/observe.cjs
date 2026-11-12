/** @file Независимые bounded PostgreSQL observations; SQL/credentials/payload не входят в evidence. */
const assert = require('node:assert/strict');
const { budget } = require('./config.cjs');

/** Возвращает aggregate gauges одной disposable БД; UUID не становятся labels или dimension. */
async function snapshot(pool) {
  const {
    rows: [row],
  } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='warehouse-controller' AND state='active') AS active,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='warehouse-controller' AND wait_event_type='Lock') AS lock_waiters,
      (SELECT coalesce(max(extract(epoch FROM clock_timestamp()-query_start)*1000),0)::float8
        FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='warehouse-controller' AND wait_event_type='Lock') AS blocked_query_age_ms,
      (SELECT count(*)::int FROM outbox_deliveries WHERE status='pending') AS pending,
      (SELECT count(*)::int FROM outbox_deliveries WHERE status='processing') AS processing,
      (SELECT count(*)::int FROM outbox_deliveries WHERE status='retry') AS retry,
      (SELECT count(*)::int FROM outbox_deliveries WHERE status='dead') AS dead,
      (SELECT count(*)::int FROM outbox_deliveries WHERE status='completed') AS completed,
      (SELECT coalesce(max(extract(epoch FROM clock_timestamp()-e.created_at)),0)::float8
        FROM outbox_deliveries d JOIN outbox_events e ON e.event_id=d.event_id
        WHERE d.status<>'completed') AS oldest_age_seconds,
      (SELECT deadlocks::float8 FROM pg_stat_database WHERE datname=current_database()) AS deadlocks,
      (SELECT xact_commit::float8 FROM pg_stat_database WHERE datname=current_database()) AS commits,
      (SELECT xact_rollback::float8 FROM pg_stat_database WHERE datname=current_database()) AS rollbacks`);
  return row;
}
/** Сэмплы последовательны: медленный SQL не создаёт дополнительные фоновые promises/pool pressure.
 * Ошибка сохраняется до stop, а не теряется в async timer. Владелец обязан вызвать stop в finally. */
function startObserver(pool, onFailure = async () => {}) {
  const started = performance.now();
  const samples = [];
  let stopped = false;
  let failure;
  let wake;
  const loop = (async () => {
    try {
      while (!stopped) {
        const value = await snapshot(pool);
        samples.push({ elapsedMs: Math.round(performance.now() - started), ...value });
        assert.ok(samples.length <= 2400, 'observer sample ceiling');
        assert.ok(
          value.pending + value.processing + value.retry <= budget.backlogCeiling,
          'backlog ceiling',
        );
        assert.equal(value.dead, 0, 'dead delivery during load');
        assert.equal(value.deadlocks, samples[0].deadlocks, 'database deadlock during load');
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, budget.sampleIntervalMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
          if (stopped) wake();
        });
      }
    } catch (error) {
      failure = error;
      // Останавливает generator по stop criteria. Первичная ошибка остаётся причиной отказа.
      await onFailure().catch(() => {});
    }
  })();
  return {
    samples,
    /** Проверяется также в driver polling, чтобы наблюдённый дефект прервал сценарий до drain. */
    assertHealthy() {
      if (failure) throw failure;
    },
    async stop() {
      stopped = true;
      wake?.();
      await loop;
      if (failure) throw failure;
      return samples;
    },
  };
}
/** Ограниченное ожидание SQL-состояния, без проглатывания ошибок или подмены skip. */
async function waitFor(read, predicate, milliseconds, label) {
  const deadline = performance.now() + milliseconds;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  throw new Error(label);
}
/** Query age не равен lock duration. Интеграл waiters — оценка по сэмплам, не pg_stat_statements. */
function summarizeSamples(samples) {
  assert.ok(samples.length > 1, 'insufficient DB observations');
  const first = samples[0];
  const last = samples.at(-1);
  return {
    sampleCount: samples.length,
    observedMs: last.elapsedMs - first.elapsedMs,
    maxLockWaiters: Math.max(...samples.map((s) => s.lock_waiters)),
    sampledWaiterMs: samples
      .slice(1)
      .reduce(
        (sum, s, i) => sum + samples[i].lock_waiters * (s.elapsedMs - samples[i].elapsedMs),
        0,
      ),
    maxBlockedQueryAgeMs: Math.max(...samples.map((s) => s.blocked_query_age_ms)),
    peakBacklog: Math.max(...samples.map((s) => s.pending + s.processing + s.retry)),
    oldestAgeSeconds: Math.max(...samples.map((s) => s.oldest_age_seconds)),
    commitsDelta: last.commits - first.commits,
    rollbacksDelta: last.rollbacks - first.rollbacks,
    deadlocksDelta: last.deadlocks - first.deadlocks,
  };
}
module.exports = { snapshot, startObserver, waitFor, summarizeSamples };
