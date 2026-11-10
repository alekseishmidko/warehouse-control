/** @file WMS-401: W3C validation, safe resource attributes, error spans, OTLP transport и log buffering. */
import '@backend/infrastructure/logging/startup';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import {
  remoteTrace,
  currentTraceparent,
  startTelemetry,
  stopTelemetry,
  traced,
  linkProducer,
} from '@backend/infrastructure/logging/telemetry';
import {
  bufferedTransaction,
  configureLogging,
  logScope,
  logEvent,
  stopLogging,
  nestLogger,
} from '@backend/infrastructure/logging/runtime-logger';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once, EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
const saved = {
  format: process.env.LOG_FORMAT,
  collector: process.env.LOG_COLLECTOR_ENABLED,
  endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
};
afterEach(async () => {
  await stopTelemetry();
  await stopLogging();
  for (const [key, value] of Object.entries({
    LOG_FORMAT: saved.format,
    LOG_COLLECTOR_ENABLED: saved.collector,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: saved.endpoint,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
test('AC-401-03: only valid nonzero W3C v00 context is accepted; no baggage is parsed', () => {
  expect(remoteTrace('00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01')).toMatchObject({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    traceFlags: 1,
    isRemote: true,
  });
  for (const value of [
    undefined,
    ['bad'],
    'SECRET',
    '00-' + '0'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
    '00-' + 'a'.repeat(32) + '-' + '0'.repeat(16) + '-01',
  ])
    expect(remoteTrace(value)).toBeUndefined();
  expect(currentTraceparent()).toBeUndefined();
});
test('AC-401-02/04: SDK resource allowlist, error without exception payload, deferred logs drop on failure', async () => {
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  process.env.LOG_FORMAT = 'json';
  const exporter = new InMemorySpanExporter(),
    lines: string[] = [];
  startTelemetry('worker', 'test', [new SimpleSpanProcessor({ exporter })]);
  configureLogging(
    { process: 'worker', environment: 'test', module: 'worker' },
    {
      write(line: string) {
        lines.push(line);
      },
    },
  );
  await expect(
    traced('operation', async () => {
      expect(currentTraceparent()).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
      await bufferedTransaction(async () => {
        logEvent('receiving.posted');
        throw new Error('PRIVATE_DRIVER_PASSWORD');
      });
    }),
  ).rejects.toThrow('PRIVATE_DRIVER_PASSWORD');
  expect(lines).toHaveLength(0);
  await logScope({ module: 'receiving' }, () =>
    bufferedTransaction(async () => {
      logEvent('receiving.posted');
      expect(lines).toHaveLength(0);
    }),
  );
  expect(JSON.parse(lines[0])).toHaveProperty('module', 'receiving');
  nestLogger.error('PRIVATE_NEST_PASSWORD');
  nestLogger.warn('PRIVATE');
  nestLogger.log('PRIVATE');
  expect(lines.join('')).not.toContain('PRIVATE');
  const span = exporter.getFinishedSpans()[0];
  expect(span.status.code).toBe(2);
  expect(span.events).toHaveLength(0);
  expect(span.resource.attributes).toMatchObject({
    'service.name': 'warehouse-backend',
    'wms.process': 'worker',
    'deployment.environment.name': 'test',
  });
  expect(JSON.stringify(span.resource.attributes)).not.toMatch(
    /command_args|password|hostname|owner/i,
  );
});
test('AC-401-01: pretty forbidden in production/central collection and invalid log format rejected', () => {
  process.env.LOG_FORMAT = 'pretty';
  process.env.LOG_COLLECTOR_ENABLED = 'true';
  expect(() =>
    configureLogging({ process: 'api', environment: 'production', module: 'http' }),
  ).toThrow();
  process.env.LOG_FORMAT = 'SECRET';
  expect(() => configureLogging({ process: 'api', environment: 'test', module: 'http' })).toThrow(
    'Invalid log format',
  );
});
test('AC-401-02: endpoint credentials/query rejected without exposing value', () => {
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'https://user:SECRET@example.test/v1/traces';
  expect(() => startTelemetry('cli', 'test')).toThrow('Invalid telemetry endpoint');
});
test('AC-401-02: real OTLP export and shutdown to local collector', async () => {
  let body = '';
  const server = createServer((req, res) => {
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
    // Exporter загружает Node built-ins через dynamic import: реальный executable,
    // а не Jest VM без experimental ESM callback. HTTP collector остаётся настоящим.
    await promisify(execFile)(
      process.execPath,
      [
        '-e',
        "const t=require('./dist/infrastructure/logging/telemetry');t.startTelemetry('cli','test');t.traced('operation',async()=>1).then(()=>t.stopTelemetry()).catch(()=>process.exitCode=1)",
      ],
      { timeout: 10000, env: { ...process.env } },
    );
    expect(body).toContain('warehouse-backend');
    expect(body).not.toMatch(/password|cookie|payload|db.statement/i);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

/** Реальный Node executable проверяет ранний fallback до загрузки Nest и подключения БД. */
test.each([
  { NODE_ENV: 'PRIVATE_ENV_SECRET', LOG_FORMAT: 'json' },
  { NODE_ENV: 'production', LOG_FORMAT: 'pretty' },
  { NODE_ENV: 'development', LOG_FORMAT: 'pretty', LOG_COLLECTOR_ENABLED: 'true' },
])('AC-401-01: executable startup fallback is one safe JSON record for %j', async (extra) => {
  const result = await promisify(execFile)(
    process.execPath,
    ['dist/infrastructure/database/check.js'],
    {
      timeout: 10000,
      env: {
        ...process.env,
        ...extra,
        DATABASE_URL: 'postgresql://user:PRIVATE_PASSWORD@127.0.0.1:1/test',
      },
    },
  ).then(
    (value) => ({ code: 0, ...value }),
    (error: unknown) => {
      if (
        !error ||
        typeof error !== 'object' ||
        !('stderr' in error) ||
        typeof error.stderr !== 'string' ||
        !('code' in error)
      )
        throw error;
      return { code: error.code, stdout: '', stderr: error.stderr };
    },
  );
  expect(result.code).toBe(1);
  const record = JSON.parse(result.stderr);
  expect(record).toMatchObject({
    event: 'process.failed',
    level: 'error',
    process: 'cli',
    environment: 'unknown',
    errorCode: 'CONFIG_INVALID',
  });
  expect(result.stderr).not.toMatch(/PRIVATE|password|at Object/i);
});

test('AC-401-01: native Pino pretty transport flushes safely in interactive development mode', async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '-e',
      "Object.defineProperty(process.stderr,'isTTY',{value:true});const l=require('./dist/infrastructure/logging/runtime-logger');l.configureLogging({process:'cli',environment:'development',module:'bootstrap'});l.logEvent('process.started');l.stopLogging().catch(()=>process.exitCode=1)",
    ],
    {
      timeout: 10000,
      env: { ...process.env, LOG_FORMAT: 'pretty', LOG_COLLECTOR_ENABLED: 'false' },
    },
  );
  expect(result.stderr).toContain('Process started');
  expect(result.stderr.trim().startsWith('{')).toBe(false);
});

test('AC-401-02: no collector still creates trace context and SDK DEBUG cannot bypass JSON sink', async () => {
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const level = process.env.OTEL_LOG_LEVEL;
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logs = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.env.OTEL_LOG_LEVEL = 'DEBUG';
    startTelemetry('cli', 'test');
    await traced('operation', async () => {
      expect(currentTraceparent()).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    });
    expect(process.env.OTEL_LOG_LEVEL).toBe('DEBUG');
    expect(errors).not.toHaveBeenCalled();
    expect(logs).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
    logs.mockRestore();
    if (level === undefined) delete process.env.OTEL_LOG_LEVEL;
    else process.env.OTEL_LOG_LEVEL = level;
  }
});

/** Ошибка EventEmitter sink не должна стать бизнес-исключением или вывести raw driver text. */
test('AC-401-01: stream errors are isolated and Nest verbosity never writes raw diagnostics', async () => {
  const lines: string[] = [];
  const sink = Object.assign(new EventEmitter(), {
    write(line: string) {
      lines.push(line);
    },
  });
  process.env.LOG_FORMAT = 'json';
  const identity = {
    process: 'cli' as const,
    environment: 'test' as const,
    module: 'bootstrap' as const,
  };
  configureLogging(identity, sink);
  configureLogging(identity, sink);
  expect(sink.listenerCount('error')).toBe(1);
  expect(() => sink.emit('error', new Error('PRIVATE_STREAM_ERROR'))).not.toThrow();
  nestLogger.debug?.('PRIVATE_DEBUG');
  nestLogger.verbose?.('PRIVATE_VERBOSE');
  nestLogger.fatal?.('PRIVATE_FATAL');
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ event: 'framework.failed' }),
  ]);
  expect(lines.join('')).not.toContain('PRIVATE');
});

test('AC-401-03: manual link helper drops invalid parents and uses active handler span', async () => {
  const exporter = new InMemorySpanExporter();
  startTelemetry('worker', 'test', [new SimpleSpanProcessor({ exporter })]);
  startTelemetry('worker', 'test', [new SimpleSpanProcessor({ exporter })]);
  linkProducer('PRIVATE_NO_ACTIVE_SPAN');
  await traced(
    'handler',
    async () => {
      linkProducer('PRIVATE_PARENT');
      linkProducer(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
      return 'completed';
    },
    true,
  );
  const [span] = exporter.getFinishedSpans();
  expect(span.links).toHaveLength(1);
  expect(span.links[0].context.traceId).toBe('a'.repeat(32));
});
