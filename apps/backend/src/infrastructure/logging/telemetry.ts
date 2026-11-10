/** @file OTel ручных безопасных spans: без HTTP query, SQL statement, payload, baggage и process argv. */
import { randomUUID } from 'node:crypto';
import { logEvent } from './runtime-logger';
import {
  context,
  diag,
  logs,
  DiagLogLevel,
  trace,
  ROOT_CONTEXT,
  SpanStatusCode,
  SpanKind,
  isSpanContextValid,
  type Span,
  type SpanContext,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
let sdk: NodeSDK | undefined;
/** Версия00 и ненулевые W3C IDs. Неизвестные версии/невалидные headers не становятся remote parent. */
export function remoteTrace(value: unknown): SpanContext | undefined {
  if (typeof value !== 'string') return;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value);
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return;
  return { traceId: m[1], spanId: m[2], traceFlags: parseInt(m[3], 16) & 1, isRemote: true };
}
/** Exporter opt-in; без endpoint spans не отправляются в сеть. Detectors отключены ради запрета argv/env/hostname PII. */
export function startTelemetry(
  role: string,
  environment: string,
  processors?: SpanProcessor[],
): void {
  if (sdk) return;
  const endpoint = processors ? undefined : process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (endpoint) {
    const url = new URL(endpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid telemetry endpoint');
  }
  // NodeSDK учитывает OTEL_LOG_LEVEL и создаёт ConsoleLogger в constructor. Не даём
  // этому неструктурированному каналу вывести аргументы/URL; перенаправляем только безопасный сигнал.
  const logLevel = process.env.OTEL_LOG_LEVEL;
  diag.disable();
  process.env.OTEL_LOG_LEVEL = 'none';
  try {
    sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [],
      logRecordProcessors: [],
      metricReaders: [],
      resource: resourceFromAttributes({
        'service.name': 'warehouse-backend',
        'service.instance.id': randomUUID(),
        'deployment.environment.name': environment,
        'wms.process': role,
        'process.pid': process.pid,
        'process.runtime.name': 'nodejs',
        'process.runtime.version': process.versions.node,
      }),
      spanProcessors:
        processors ??
        (endpoint
          ? [
              new BatchSpanProcessor({
                exporter: new OTLPTraceExporter({ url: endpoint, timeoutMillis: 1000 }),
                exportTimeoutMillis: 1500,
              }),
            ]
          : [{ onStart() {}, onEnd() {}, async forceFlush() {}, async shutdown() {} }]),
    });
  } finally {
    if (logLevel === undefined) delete process.env.OTEL_LOG_LEVEL;
    else process.env.OTEL_LOG_LEVEL = logLevel;
  }
  diag.setLogger(
    {
      error() {
        logEvent('telemetry.failed', { module: 'bootstrap', errorCode: 'TELEMETRY_FAILED' });
      },
      warn() {},
      info() {},
      debug() {},
      verbose() {},
    },
    DiagLogLevel.ERROR,
  );
  sdk.start();
}
/** Shutdown exporter ограничивается exporter timeout; вызывается владельцем после закрытия приложения. */
export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
  diag.disable();
  logs.disable();
  trace.disable();
  context.disable();
}
/** Передаётся только traceparent активного span, без tracestate/baggage. */
export function currentTraceparent(): string | undefined {
  const s = trace.getActiveSpan()?.spanContext();
  return s && isSpanContextValid(s)
    ? `00-${s.traceId}-${s.spanId}-${(s.traceFlags & 1).toString(16).padStart(2, '0')}`
    : undefined;
}
/** Ошибка не записывается в span: driver text/exception stack могут содержать секрет. */
export async function traced<T>(
  name: 'transaction' | 'operation' | 'handler',
  work: (span: Span) => Promise<T>,
  root = false,
): Promise<T> {
  const span = trace
    .getTracer('warehouse')
    .startSpan(
      name,
      { kind: name === 'handler' ? SpanKind.CONSUMER : SpanKind.INTERNAL },
      root ? ROOT_CONTEXT : context.active(),
    );
  return context.with(trace.setSpan(root ? ROOT_CONTEXT : context.active(), span), async () => {
    try {
      const result = await work(span);
      span.setStatus({
        code:
          name === 'handler' && (result === 'retry' || result === 'dead')
            ? SpanStatusCode.ERROR
            : name === 'handler' && result === 'stale'
              ? SpanStatusCode.UNSET
              : SpanStatusCode.OK,
      });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
/** Отложенный consumer начинает собственный trace и связывает его с producer link. */
export function linkProducer(parent: unknown, span = trace.getActiveSpan()): void {
  const remote = remoteTrace(parent);
  if (remote) span?.addLink({ context: remote });
}
