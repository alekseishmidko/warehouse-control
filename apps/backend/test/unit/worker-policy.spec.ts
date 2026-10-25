/** @file Worker config/retry/registry contracts без Docker; SQL atomicity проверяется отдельно integration. */
import { validateWorkerEnvironment } from '@backend/infrastructure/worker/worker.config';
import { classifyDeliveryError, PermanentDeliveryError, retryDelayMs } from '@backend/infrastructure/worker/delivery-policy';
import { EventContractError } from '@backend/shared/events/event-contract.error';
import { HandlerRegistry } from '@backend/infrastructure/worker/services/handler-registry';
const config = validateWorkerEnvironment({});
test('worker defaults fit bounded pool and lease/shutdown exceed transaction timeout', () => {
  expect(config).toMatchObject({ batchSize: 4, pollIntervalMs: 1000, leaseMs: 30000, maxAttempts: 10, retryBaseMs: 1000, retryMaxMs: 60000 });
  expect(config.shutdownTimeoutMs).toBeGreaterThan(config.transactionTimeoutMs);
});
test.each([
  { WORKER_BATCH_SIZE: '5' }, { WORKER_POLL_INTERVAL_MS: '0' }, { WORKER_LEASE_MS: '1000' },
  { WORKER_RETRY_BASE_MS: 'secret' }, { WORKER_RETRY_MAX_MS: '1' }, { WORKER_MAX_ATTEMPTS: '-1' },
  { WORKER_TRANSACTION_TIMEOUT_MS: '0' }, { WORKER_SHUTDOWN_TIMEOUT_MS: '1000' },
])('invalid config %j fails without leaking values', env => {
  expect(() => validateWorkerEnvironment(env)).toThrow();
  try { validateWorkerEnvironment(env); } catch (error) { expect(String(error)).not.toContain('secret'); }
});
test('equal jitter grows exponentially and remains capped for all attempts', () => {
  expect(retryDelayMs(1, config, 0)).toBe(500); expect(retryDelayMs(2, config, 1)).toBe(2000);
  expect(retryDelayMs(1000, config, 0)).toBe(30000); expect(retryDelayMs(1000, config, 1)).toBe(60000);
});
test('classification keeps only safe codes; transient errors retry boundedly', () => {
  expect(classifyDeliveryError(new EventContractError('UNSUPPORTED_EVENT'))).toEqual({ permanent: true, code: 'UNSUPPORTED_EVENT' });
  expect(classifyDeliveryError(new PermanentDeliveryError('HANDLER_REJECTED')).permanent).toBe(true);
  expect(classifyDeliveryError({ cause: { code: '23514', message: 'secret' } })).toEqual({ permanent: true, code: 'DATABASE_REJECTED' });
  for (const code of ['40001', '40P01', '08006', '25P04', '57014']) expect(classifyDeliveryError({ cause: { code } }).permanent).toBe(false);
  expect(classifyDeliveryError(new Error('secret'))).toEqual({ permanent: false, code: 'TRANSIENT_FAILURE' });
  const forged = new PermanentDeliveryError('HANDLER_REJECTED'); Object.assign(forged, { code: 'secret' });
  expect(classifyDeliveryError(forged)).toEqual({ permanent: true, code: 'HANDLER_REJECTED' });
});
test('empty production registry has no fake consumer; duplicate/unregistered destinations rejected', () => {
  expect(new HandlerRegistry([]).destinations()).toEqual([]);
  const handler = { destination: 'inventory.putaway', handle: async () => {} };
  expect(() => new HandlerRegistry([handler, handler])).toThrow();
  expect(() => new HandlerRegistry([{ ...handler, destination: 'unknown' }])).toThrow();
});
