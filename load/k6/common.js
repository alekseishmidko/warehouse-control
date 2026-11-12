/** @file Общий k6 HTTP adapter: настоящие session/CSRF, стабильные metric tags, без payload logs/retry. */
import http from 'k6/http';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

// Файл 0600 существует только во временном каталоге driver, никогда не попадает в summary.
export const dataset = JSON.parse(open('/input/dataset.json'));
const unexpected = new Rate('unexpected_responses');
export const posted = new Counter('receipts_posted');
export const won = new Counter('reserve_successes');
export const conflicted = new Counter('reserve_conflicts');
export const pairDuration = new Trend('receipt_pair_http_ms', true);

/** UUID команды детерминирован в пределах прогона. После ошибки запрос не повторяется новым key. */
export function commandKey(command) {
  const h = crypto.sha256(
    `${dataset.runId}/${dataset.scenario}/${__VU}/${__ITER}/${command}`,
    'hex',
  );
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Каждый VU использует отдельного пользователя: session touch не создаёт общий конкурентный bottleneck. */
export function actor() {
  return dataset.actors[__VU - 1];
}
/** Пишет только конечный статус/имя операции при отказе. UUID в URL не становится metric tag. */
export function request(path, body, name, statuses = [200]) {
  const user = actor();
  const response = http.post('http://127.0.0.1:3000' + path, JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3000',
      Cookie: user.cookie,
      'X-CSRF-Token': user.csrfToken,
      'Idempotency-Key': commandKey(name),
    },
    tags: { name },
    timeout: `${dataset.budget.requestTimeoutMs}ms`,
    responseCallback: http.expectedStatuses(...statuses),
  });
  let result;
  try {
    result = response.json();
  } catch {
    unexpected.add(true);
    exec.test.abort(`${name}: invalid JSON, status ${response.status}`);
  }
  const valid =
    statuses.includes(response.status) &&
    (response.status === 409
      ? result.code === 'INSUFFICIENT_STOCK'
      : typeof result.id === 'string');
  unexpected.add(!valid);
  if (!valid) exec.test.abort(`${name}: unexpected response, status ${response.status}`);
  return { response, result };
}
/** Одна итерация — два HTTP commit: создание и проведение однострочной приёмки. */
export function receive() {
  const fixture = actor().fixture;
  const draft = request(
    '/api/v1/receipts',
    {
      warehouseId: fixture.warehouseId,
      receivingLocationId: fixture.receivingLocationId,
      lines: [{ productId: fixture.productId, quantity: 1 }],
    },
    'receipt.create',
    [201],
  );
  const receipt = request(`/api/v1/receipts/${draft.result.id}/post`, {}, 'receipt.post');
  pairDuration.add(draft.response.timings.duration + receipt.response.timings.duration);
  posted.add(1);
}
/** Ограниченный профиль с заданным входным потоком. Expected conflict — бизнес-отказ, а не ошибка транспорта. */
export function optionsFor(scenario) {
  const b = dataset.budget;
  return {
    scenarios: {
      [scenario]:
        scenario === 'throughput'
          ? {
              executor: 'constant-arrival-rate',
              rate: b.throughputReceiptsPerSecond,
              timeUnit: '1s',
              preAllocatedVUs: b.vus,
              maxVUs: b.vus,
              duration: `${b.throughputSeconds}s`,
              gracefulStop: '15s',
            }
          : {
              executor: 'per-vu-iterations',
              vus: b.vus,
              iterations: scenario === 'sku' ? 1 : b.backlogIterationsPerVu,
              maxDuration: '60s',
              gracefulStop: '15s',
            },
    },
    systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
    summaryTrendStats: ['avg', 'min', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
    thresholds: {
      unexpected_responses: [{ threshold: 'rate==0', abortOnFail: true, delayAbortEval: '2s' }],
      http_req_failed: ['rate==0'],
      http_req_duration: [`p(99)<${b.httpP99SafetyMs}`],
      dropped_iterations: ['count==0'],
    },
  };
}
/** Summary не включает dataset, cookie, произвольный HTTP body или URL с идентификатором. */
export function summary(data) {
  return {
    '/output/summary.json': JSON.stringify(
      { schemaVersion: 1, metrics: data.metrics, state: data.state },
      null,
      2,
    ),
  };
}
