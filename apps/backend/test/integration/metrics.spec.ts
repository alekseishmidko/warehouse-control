/** @file WMS-402: настоящий PostgreSQL snapshot и timeout scrape без warehouse writes и зависимости от log sink. */
import { once } from 'node:events';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import {
  startMetrics,
  stopMetrics,
  registerMetricsPool,
  renderMetrics,
} from '@backend/infrastructure/metrics/runtime-metrics';
import { configureLogging, stopLogging } from '@backend/infrastructure/logging/runtime-logger';
const db = useDatabaseSuite();
const saved = process.env.WMS_METRICS_PORT;
beforeAll(async () => {
  process.env.WMS_METRICS_PORT = '0';
  const server = startMetrics('api');
  await once(server!, 'listening');
  registerMetricsPool(db().connection.pool);
  configureLogging(
    { process: 'api', environment: 'test', module: 'http' },
    {
      write() {
        throw new Error('PRIVATE_SINK_FAILURE');
      },
    },
  );
});
afterAll(async () => {
  await stopLogging();
  stopMetrics();
  if (saved === undefined) delete process.env.WMS_METRICS_PORT;
  else process.env.WMS_METRICS_PORT = saved;
});
test('AC-402-02: real outbox gauges reflect committed receipt despite failed diagnostic sink; parallel scrapes share SQL', async () => {
  const app = await db().createHttpApplication();
  await postedReceiptFixture(app);
  const first = renderMetrics();
  expect(renderMetrics()).toBe(first);
  const text = await first;
  expect(text).toContain('wms_outbox_deliveries{status="pending"} 1');
  expect(text).toContain('wms_outbox_deliveries{status="dead"} 0');
  expect(text).toContain('wms_outbox_scrape_success 1');
  expect(text).toMatch(/wms_db_pool_connections [1-9]/);
  expect(text).toMatch(/wms_events_total\{event="receiving.posted"\} 1/);
  expect(text).not.toMatch(/PRIVATE|password|postgresql|aggregateId/);
});
test('AC-402-02: real table lock cancels snapshot with server timeout and reports failure without driver data', async () => {
  const blocker = await db().connection.pool.connect();
  try {
    await blocker.query('begin');
    await blocker.query('lock table outbox_deliveries in access exclusive mode');
    const text = await renderMetrics();
    expect(text).toContain('wms_outbox_scrape_success 0');
    expect(text).not.toMatch(/lock timeout|statement timeout|select d|PRIVATE/);
  } finally {
    await blocker.query('rollback');
    blocker.release();
  }
});
