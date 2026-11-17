/** @file Локальный scrape endpoint: фиксированные серии, без URL/UUID/payload и сетевого push из бизнес-транзакции. */
import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import { LOG_EVENTS, type LogEvent, type LogFields } from '../../shared/logging/log-contract';
const counts = new Map<LogEvent, number>();
const bounds = [0.01, 0.05, 0.1, 0.5, 1, 5, 30] as const;
const buckets = bounds.map(() => 0);
let durationSum = 0,
  durationCount = 0;
let role = 'api';
let server: Server | undefined;
const pools = new Set<Pool>();
let kafkaMetrics: (() => string[]) | undefined;
/** Read-only cached Kafka gauges: collector не вызывает broker из DB transaction/scrape. */
export function registerKafkaMetrics(provider: () => string[]): () => void {
  kafkaMetrics = provider;
  return () => {
    if (kafkaMetrics === provider) kafkaMetrics = undefined;
  };
}
/** Метрики считаются независимо от доставки Pino/Loki; буфер транзакции вызывает после commit. */
export function observeLogEvent(event: LogEvent, fields: LogFields): void {
  if (!server || !Object.hasOwn(LOG_EVENTS, event)) return;
  counts.set(event, (counts.get(event) ?? 0) + 1);
  if (event.startsWith('http.') && fields.durationMs !== undefined) {
    const seconds = fields.durationMs / 1000;
    durationSum += seconds;
    durationCount++;
    bounds.forEach((bound, index) => {
      if (seconds <= bound) buckets[index]++;
    });
  }
}
/** Pool принадлежит DatabaseService; exporter не создаёт свой login и не выводит connectionString. */
export function registerMetricsPool(pool: Pool): void {
  if (server) pools.add(pool);
}
/** Read-only snapshot с серверным timeout; ошибки не выводят SQL/driver details. */
async function outboxSnapshot(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout='750ms'");
    const result = await client.query<{
      status: string;
      count: string;
      age: string;
    }>(`select d.status, count(*)::text count,
      greatest(0, extract(epoch from clock_timestamp()-min(e.created_at)))::text age
      from outbox_deliveries d join outbox_events e using(event_id) group by d.status`);
    const kafka = await client.query<{ status: string; count: string; age: string }>(
      `select status,count(*)::text count,greatest(0,extract(epoch from clock_timestamp()-min(created_at)))::text age from kafka_quarantine where status<>'resolved' group by status`,
    );
    const oldest = await client.query<{ age: string }>(
      `select greatest(0,coalesce(extract(epoch from clock_timestamp()-min(e.created_at)),0))::text age from outbox_events e where e.aggregate_type='receipt' and not exists(select 1 from processed_events p where p.consumer_name='inventory.putaway' and p.event_id=e.event_id)`,
    );
    await client.query('commit');
    return [
      'wms_outbox_scrape_success 1',
      `wms_kafka_oldest_unprocessed_age_seconds ${Math.max(Number(oldest.rows[0].age), ...kafka.rows.map((r) => Number(r.age)))}`,
      ...['retry', 'quarantine'].flatMap((status) => {
        const row = kafka.rows.find((r) => r.status === status);
        return [
          `wms_kafka_records{status="${status}"} ${Number(row?.count ?? 0)}`,
          `wms_kafka_oldest_blocked_age_seconds{status="${status}"} ${Number(row?.age ?? 0)}`,
        ];
      }),
      ...['pending', 'retry', 'processing', 'dead', 'completed'].flatMap((status) => {
        const row = result.rows.find((value) => value.status === status);
        return [
          `wms_outbox_deliveries{status="${status}"} ${Number(row?.count ?? 0)}`,
          `wms_outbox_oldest_age_seconds{status="${status}"} ${Number(row?.age ?? 0)}`,
        ];
      }),
    ];
  } catch {
    await client.query('rollback').catch(() => {});
    return ['wms_outbox_scrape_success 0'];
  } finally {
    client.release();
  }
}
/** Snapshot сохраняет нулевые серии, чтобы alerts могли разрешиться после dead→retry→completed. */
async function collectMetrics(): Promise<string> {
  const lines = [
    '# TYPE wms_events_total counter',
    '# TYPE wms_http_duration_seconds histogram',
    '# TYPE wms_outbox_deliveries gauge',
    '# TYPE wms_outbox_oldest_age_seconds gauge',
    '# TYPE wms_outbox_scrape_success gauge',
    '# TYPE wms_process_up gauge',
    '# TYPE wms_db_pool_connections gauge',
    '# TYPE wms_db_pool_idle gauge',
    '# TYPE wms_db_pool_waiting gauge',
    `wms_process_up{process="${role}"} 1`,
    `wms_process_uptime_seconds ${process.uptime()}`,
  ];
  for (const event of Object.keys(LOG_EVENTS) as LogEvent[])
    lines.push(`wms_events_total{event="${event}"} ${counts.get(event) ?? 0}`);
  bounds.forEach((bound, index) =>
    lines.push(`wms_http_duration_seconds_bucket{le="${bound}"} ${buckets[index]}`),
  );
  lines.push(
    `wms_http_duration_seconds_bucket{le="+Inf"} ${durationCount}`,
    `wms_http_duration_seconds_sum ${durationSum}`,
    `wms_http_duration_seconds_count ${durationCount}`,
  );
  let total = 0,
    idle = 0,
    waiting = 0;
  for (const pool of pools) {
    if (pool.ended) {
      pools.delete(pool);
      continue;
    }
    total += pool.totalCount;
    idle += pool.idleCount;
    waiting += pool.waitingCount;
  }
  lines.push(
    `wms_db_pool_connections ${total}`,
    `wms_db_pool_idle ${idle}`,
    `wms_db_pool_waiting ${waiting}`,
  );
  const pool = [...pools].find((value) => !value.ended);
  if (pool) {
    try {
      lines.push(...(await outboxSnapshot(pool)));
    } catch {
      lines.push('wms_outbox_scrape_success 0');
    }
  }
  if (kafkaMetrics) lines.push(...kafkaMetrics());
  return lines.join('\n') + '\n';
}
let inFlight: Promise<string> | undefined;
/** Concurrent scrape разделяют один snapshot: endpoint не размножает SQL queries по числу клиентов. */
export function renderMetrics(): Promise<string> {
  inFlight ??= collectMetrics().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
/** Opt-in отдельный listener, не warehouse HTTP API; scrape не проходит через auth и не возвращает бизнес-данные. */
export function startMetrics(processRole: 'api' | 'worker' | 'cli'): Server | undefined {
  const port = process.env.WMS_METRICS_PORT;
  if (!port || processRole === 'cli') return;
  if (!/^\d+$/.test(port) || Number(port) < 0 || Number(port) > 65535)
    throw new Error('Invalid metrics port');
  if (server) return server;
  role = processRole;
  server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    void renderMetrics()
      .then((body) => {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.end(body);
      })
      .catch(() => res.writeHead(503).end());
  });
  // Scrape keep-alive не должен удерживать процесс после отказа startup или остановки приложения.
  server.on('connection', (socket) => socket.unref());
  server.on('error', () => {
    process.exitCode = 1;
  });
  server.listen(Number(port), process.env.WMS_METRICS_HOST ?? '127.0.0.1');
  server.unref();
  process.once('SIGTERM', stopMetrics);
  process.once('SIGINT', stopMetrics);
  return server;
}

/** Прекращает scrape до shutdown pool; не удерживает остановку приложения из-за клиента collector. */
export function stopMetrics(): void {
  process.off('SIGTERM', stopMetrics);
  process.off('SIGINT', stopMetrics);
  server?.closeAllConnections();
  server?.close();
  server = undefined;
  pools.clear();
  counts.clear();
  buckets.fill(0);
  durationSum = 0;
  durationCount = 0;
}
