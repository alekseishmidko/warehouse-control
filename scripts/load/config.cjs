/** @file Фиксированный бюджет WMS-403. Вход выбирает сценарий, но не чужую БД/URL/credentials. */
const assert = require('node:assert/strict');
const K6_IMAGE =
  'grafana/k6:1.1.0@sha256:aa8202f377550cee0c8bad295bbe8d2d4d4cf88d15c98383e9ecc53c56882308';
const SCENARIOS = ['throughput', 'sku', 'backlog'];
/** Отклоняет неизвестные аргументы до создания ресурсов; baseline означает последовательные чистые стенды. */
function selectScenarios(args) {
  assert.equal(args.length, 1, 'usage: node scripts/load/run.cjs throughput|sku|backlog|baseline');
  assert.ok([...SCENARIOS, 'baseline'].includes(args[0]), 'unknown load scenario');
  return args[0] === 'baseline' ? SCENARIOS : [args[0]];
}
/** Локальный Docker socket обязателен: настройка remote context не должна превратить benchmark во внешний deployment. */
function assertLocalDockerEndpoint(endpoint) {
  assert.match(endpoint, /^unix:\/\//, 'load requires a local Unix Docker socket');
}
/** Сериализуемая конфигурация без секретов; thresholds — предохранители dev, а не согласованный SLO. */
const budget = Object.freeze({
  vus: 4,
  throughputSeconds: 20,
  throughputReceiptsPerSecond: 10,
  settleSeconds: 15,
  backlogIterationsPerVu: 25,
  requestTimeoutMs: 10000,
  barrierTimeoutMs: 5000,
  drainTimeoutMs: 60000,
  sampleIntervalMs: 100,
  backlogCeiling: 1000,
  unexpectedResponseRate: 0,
  httpP99SafetyMs: 5000,
  api: { cpus: 2, memoryMiB: 512 },
  worker: { cpus: 1, memoryMiB: 256, pollMs: 100, batchSize: 4 },
  postgres: { cpus: 2, memoryMiB: 512 },
  k6: { cpus: 1, memoryMiB: 256 },
});
module.exports = { K6_IMAGE, SCENARIOS, selectScenarios, budget, assertLocalDockerEndpoint };
