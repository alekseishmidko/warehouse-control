/** @file WMS-402: настоящий scrape listener, bounded labels, histogram и opt-in без collector. */
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  startMetrics,
  stopMetrics,
  renderMetrics,
  observeLogEvent,
} from '@backend/infrastructure/metrics/runtime-metrics';
const saved = process.env.WMS_METRICS_PORT;
afterEach(() => {
  stopMetrics();
  if (saved === undefined) delete process.env.WMS_METRICS_PORT;
  else process.env.WMS_METRICS_PORT = saved;
});
test('AC-402-02: disabled/CLI creates no listener; invalid configured ports fail safely', () => {
  delete process.env.WMS_METRICS_PORT;
  expect(startMetrics('api')).toBeUndefined();
  observeLogEvent('http.completed', {});
  process.env.WMS_METRICS_PORT = 'SECRET';
  expect(startMetrics('cli')).toBeUndefined();
  expect(() => startMetrics('worker')).toThrow('Invalid metrics port');
});
test('AC-402-02: real HTTP scrape reports bounded counters/histogram without IDs or URL labels', async () => {
  process.env.WMS_METRICS_PORT = '0';
  const server = startMetrics('api');
  expect(server).toBeDefined();
  await once(server!, 'listening');
  observeLogEvent('http.completed', { durationMs: 42, correlationId: 'PRIVATE_UUID' });
  observeLogEvent('http.failed', { durationMs: 2000 });
  observeLogEvent('delivery.retry', {});
  const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const response = await fetch(url + '/metrics');
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('wms_events_total{event="http.completed"} 1');
  expect(body).toContain('wms_http_duration_seconds_count 2');
  expect(body).toContain('wms_http_duration_seconds_bucket{le="0.05"} 1');
  expect(body).toContain('wms_http_duration_seconds_bucket{le="+Inf"} 2');
  expect(body).not.toMatch(/PRIVATE|correlationId|eventId|aggregateId|path=|url=/);
  expect((await fetch(url + '/missing')).status).toBe(404);
  expect((await fetch(url + '/metrics', { method: 'POST' })).status).toBe(404);
  const snapshot = renderMetrics();
  expect(renderMetrics()).toBe(snapshot);
  await snapshot;
});
