/** @file WMS-401: формат каждой JSON строки, allowlist и контекст параллельных сценариев реального Pino adapter. */
import { randomUUID } from 'node:crypto';
import { createOperationalLogger } from '@backend/infrastructure/logging/pino-logger';
import { safeLogFields } from '@backend/shared/logging/log-contract';
/** In-memory sink выполняет реальную Pino сериализацию, без подмены logger. */
function fixture() {
  const lines: string[] = [];
  const logger = createOperationalLogger(
    { process: 'api', environment: 'test', module: 'http' },
    {
      write(value: string) {
        lines.push(value);
      },
    },
  );
  return { logger, lines };
}
test('AC-401-01: every line is JSON with required fields and no payload or raw errors', () => {
  const { logger, lines } = fixture();
  const input = {
    correlationId: randomUUID(),
    password: 'SECRET',
    payload: { customer: 'PERSON' },
    err: new Error('DRIVER_SECRET'),
  };
  logger.child(input).emit('operation.completed', input);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toEqual({
    timestamp: expect.any(String),
    level: 'info',
    service: 'warehouse-backend',
    environment: 'test',
    process: 'api',
    module: 'http',
    event: 'operation.completed',
    message: 'Operation completed',
    correlationId: input.correlationId,
  });
  expect(lines.join('')).not.toMatch(/SECRET|PERSON|password|payload|err/);
});
test('AC-401-02: concurrent async scopes and child loggers do not leak correlation', async () => {
  const { logger, lines } = fixture();
  const ids = [randomUUID(), randomUUID()];
  const child = logger.child({ attempt: 2 });
  await Promise.all(
    ids.map((correlationId) =>
      logger.run({ correlationId }, async () => {
        await Promise.resolve();
        child.emit('operation.started');
        await Promise.resolve();
        child.emit('operation.completed');
      }),
    ),
  );
  const rows = lines.map(
    (line) => JSON.parse(line) as { correlationId?: string; attempt?: number },
  );
  for (const id of ids) expect(rows.filter((row) => row.correlationId === id)).toHaveLength(2);
  expect(rows.every((row) => row.attempt === 2)).toBe(true);
  logger.emit('process.started');
  expect(JSON.parse(lines[4])).not.toHaveProperty('correlationId');
});
test('AC-401-01: malformed IDs, nonfinite durations and invalid attempts are discarded', () => {
  expect(
    safeLogFields({
      correlationId: 'SECRET',
      traceId: '0'.repeat(32),
      spanId: 'x'.repeat(16),
      attempt: 0,
      durationMs: NaN,
    }),
  ).toEqual({});
  expect(
    safeLogFields({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), durationMs: 0, attempt: 1 }),
  ).toEqual({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), durationMs: 0, attempt: 1 });
});
test('AC-401-01: synchronous sink error does not change operation result', () => {
  const logger = createOperationalLogger(
    { process: 'cli', environment: 'test', module: 'cli' },
    {
      write() {
        throw new Error('sink unavailable');
      },
    },
  );
  expect(() => logger.emit('process.failed')).not.toThrow();
});

test('AC-401-01: identity bindings exclude additional secrets', () => {
  const lines: string[] = [];
  const identity = {
    process: 'api' as const,
    environment: 'test' as const,
    module: 'http' as const,
    privateCredential: 'IDENTITY_SECRET',
  };
  createOperationalLogger(identity, {
    write(line: string) {
      lines.push(line);
    },
  }).emit('process.started');
  expect(lines.join('')).not.toContain('IDENTITY_SECRET');
});

test('AC-401-02: throwing scope restores the parent context', () => {
  const { logger, lines } = fixture();
  expect(() =>
    logger.run({ correlationId: randomUUID() }, () => {
      throw new Error('internal');
    }),
  ).toThrow('internal');
  logger.emit('process.started');
  expect(JSON.parse(lines[0])).not.toHaveProperty('correlationId');
});
test('AC-401-01: invalid identity fails before output and boundary quantities are filtered', () => {
  const identity = JSON.parse(
    '{"process":"api","environment":"SECRET","module":"http"}',
  ) as Parameters<typeof createOperationalLogger>[0];
  expect(() =>
    createOperationalLogger(identity, {
      write() {
        throw new Error('must not write');
      },
    }),
  ).toThrow('Invalid logging identity');
  expect(safeLogFields({ attempt: 1.2, durationMs: -1 })).toEqual({});
  const id = randomUUID();
  expect(safeLogFields({ eventId: id.toUpperCase(), aggregateId: id.toUpperCase() })).toEqual({
    eventId: id,
    aggregateId: id,
  });
});

test('AC-401-01: module child reuses sink and emits one unambiguous module field', () => {
  const { logger, lines } = fixture();
  logger.child({ module: 'receiving' }).emit('operation.started');
  expect(JSON.parse(lines[0])).toHaveProperty('module', 'receiving');
  expect(lines[0].match(/"module":/g)).toHaveLength(1);
  logger.emit('process.started');
  expect(JSON.parse(lines[1])).toHaveProperty('module', 'http');
});

test('AC-401-01: malformed event cannot change an already committed result', () => {
  const { logger, lines } = fixture();
  expect(() => logger.emit('not-an-event' as Parameters<typeof logger.emit>[0])).not.toThrow();
  expect(lines).toHaveLength(0);
  expect(
    safeLogFields({
      destination: 'inventory.putaway',
      errorCode: 'LOCAL_ACCESS_REQUIRED',
      code: 'LOCAL_ACCESS_REQUIRED',
      httpStatus: 403,
    }),
  ).toMatchObject({
    destination: 'inventory.putaway',
    errorCode: 'LOCAL_ACCESS_REQUIRED',
    code: 'LOCAL_ACCESS_REQUIRED',
    httpStatus: 403,
  });
  expect(
    safeLogFields({
      destination: 'secret\n',
      errorCode: 'SECRET',
      code: 'SECRET',
      httpStatus: 600,
    }),
  ).toEqual({});
});
