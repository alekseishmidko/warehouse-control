/** @file WMS-111: настоящий compiled CLI и PostgreSQL проверяют права, lease/блокировки,
 * курсоры и атомарность retry/аудита/истории. Контейнер и fault injection изолированы harness. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { useDatabaseSuite } from '../support/database-harness';
import { postedReceiptFixture } from '../support/posted-receipt.fixture';
import { outboxFixture } from '../support/outbox.fixture';
import { OutboxRecoveryService } from '@backend/infrastructure/outbox/services/outbox-recovery.service';
import { RecoveryRepository } from '@backend/infrastructure/outbox/repositories/recovery.repository';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { AuditService } from '@backend/modules/audit/services/audit.service';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { validateWorkerEnvironment } from '@backend/infrastructure/worker/worker.config';

const database = useDatabaseSuite();
let api: INestApplication;
let app: INestApplicationContext;
let recovery: OutboxRecoveryService;
let worker: WorkerService;
beforeAll(async () => {
  api = await database().createHttpApplication();
  app = await database().createWorkerApplication();
  recovery = api.get(OutboxRecoveryService);
  worker = app.get(WorkerService);
});
/** Синтетический адрес зарегистрированного получателя; сервис всё равно повторно проверяет поля. */
const address = (eventId: string) => ({ eventId, consumer: 'inventory.putaway' });
/** Новые UUID оператора/вмешательства для теста; это не проверка пользовательского каталога. */
const command = (eventId: string) => ({
  ...address(eventId),
  operatorId: randomUUID(),
  reasonCode: 'dependency-restored',
  correlationId: randomUUID(),
});
/** Запускает compiled CLI отдельным процессом с тестовой средой; process.env родителя не меняет.
 * Credentials передаются только средой, а не argv. Предел 10s и maxBuffer 256 KiB ограничивают
 * зависший/слишком многословный процесс; возвращаем его код/stdout/stderr для утверждений теста. */
async function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [resolve('dist/infrastructure/outbox/outbox-admin.js'), ...args],
      {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DEV_ACTOR_ENABLED: 'false',
          DATABASE_URL: database().config.databaseUrl,
          OUTBOX_ADMIN_ENABLED: 'true',
          ...env,
        },
        timeout: 10000,
        maxBuffer: 262144,
      },
    );
    return { code: 0, ...result };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
}
/** Создаёт dead-состояние только в disposable БД для негативных проверок и границы int4.
 * Не является production API восстановления. Основной runbook получает dead через настоящий отказ handler. */
async function dead(eventId: string, attempts = 1) {
  await database().connection.pool.query(
    "update outbox_deliveries set status='dead',attempts=$2,last_error='TRANSIENT_FAILURE' where event_id=$1",
    [eventId, attempts],
  );
}

/** Проверка полного runbook: реальный отказ → dead → устранение fault → CLI retry → один task.
 * SQL-счётчики подтверждают отсутствие повторного движения/начисления, история связана с оператором и аудитом. */
test('verified runbook: fault → dead/signal → inspect → CLI retry with operator/reason → one task and unchanged stock', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  const pool = database().connection.pool;
  // AFTER INSERT trigger падает уже после попытки записи задания: проверяем откат эффекта,
  // а затем отдельную фиксацию dead worker. Удаление fault имитирует устранение причины.
  await pool.query(
    "create function recovery_drill_fault() returns trigger language plpgsql as $$ begin raise exception 'injected constraint failure' using errcode='23514'; end $$",
  );
  try {
    await pool.query(
      'create trigger recovery_drill_fault after insert on putaway_tasks for each row execute function recovery_drill_fault()',
    );
    try {
      const [claim] = await worker.claim();
      expect(await worker.process(claim)).toBe('dead');
    } finally {
      await pool.query('drop trigger recovery_drill_fault on putaway_tasks');
    }
  } finally {
    await pool.query('drop function recovery_drill_fault()');
  }
  const inspected = await cli([
    'inspect',
    '--event',
    eventId,
    '--consumer',
    'inventory.putaway',
    '--payload',
  ]);
  expect(inspected.code).toBe(0);
  const before = JSON.parse(inspected.stdout);
  expect(before).toMatchObject({
    eventId,
    status: 'dead',
    attempt: 1,
    lastError: 'DATABASE_REJECTED',
    payload: { lineCount: 1 },
  });
  expect(before).not.toHaveProperty('leaseToken');
  expect(before).not.toHaveProperty('envelope');
  const alert = await cli(['signal']);
  expect(alert.code).toBe(2);
  expect(JSON.parse(alert.stdout)).toMatchObject({ dead: 1, blockedStreams: 1, status: 'alert' });
  const request = command(eventId);
  const retried = await cli([
    'retry',
    '--event',
    eventId,
    '--consumer',
    request.consumer,
    '--operator',
    request.operatorId,
    '--reason',
    request.reasonCode,
  ]);
  expect(retried.code).toBe(0);
  expect(JSON.parse(retried.stdout)).toMatchObject({
    eventId,
    status: 'retry',
    attempt: 1,
    retryAttemptBase: 1,
    operatorId: request.operatorId,
  });
  const [claim] = await worker.claim();
  expect(claim.eventId).toBe(eventId);
  expect(claim.attempt).toBe(2);
  expect(await worker.process(claim)).toBe('completed');
  const after = await cli(['inspect', '--event', eventId, '--consumer', 'inventory.putaway']);
  expect(JSON.parse(after.stdout)).toMatchObject({
    status: 'completed',
    attempt: 2,
    processed: true,
    deliveryCursor: 1,
    consumerCursor: 1,
    recoveryHistory: [
      { operatorId: request.operatorId, previousAttempts: 1, previousError: 'DATABASE_REJECTED' },
    ],
  });
  const normal = await cli(['signal']);
  expect(normal.code).toBe(0);
  expect(JSON.parse(normal.stdout)).toMatchObject({ dead: 0, backlog: 0 });
  expect((await pool.query('select on_hand,reserved from stock_balances')).rows).toEqual([
    { on_hand: 10, reserved: 0 },
  ]);
  for (const table of [
    'putaway_tasks',
    'stock_movements',
    'processed_events',
    'outbox_events',
    'outbox_recovery_actions',
  ]) {
    expect((await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n).toBe(1);
  }
  expect(
    (
      await pool.query(
        "select actor_id,reason_code from audit_entries where action='outbox.delivery-retry-scheduled'",
      )
    ).rows,
  ).toEqual([{ actor_id: request.operatorId, reason_code: request.reasonCode }]);
  expect(inspected.stdout + inspected.stderr + retried.stdout + retried.stderr).not.toContain(
    database().config.databaseUrl,
  );
});

/** Общий attempts=10 сохраняется при retry; новый budget позволяет claim №11,
 * а previousAttempts в истории продолжает объяснять исчерпанные попытки. */
test('retry renews budget after maxAttempts without decreasing total attempts or erasing previous error history', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  await dead(eventId, 10);
  await recovery.retry(command(eventId));
  const next = await recovery.inspect(address(eventId));
  expect(next.attempt).toBe(10);
  expect(next.lastError).toBe('TRANSIENT_FAILURE');
  const [claim] = await worker.claim();
  expect(claim.attempt).toBe(11);
  expect(await worker.process(claim)).toBe('completed');
  expect((await recovery.inspect(address(eventId))).recoveryHistory[0].previousAttempts).toBe(10);
});

/** На границе int4 нельзя открыть новый budget: следующий attempts+1 переполнился бы.
 * Отказ не должен оставить ни историю, ни изменённый статус. */
test('int4 attempt limit rejects retry rather than creating an endlessly overflowing claim', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  await dead(eventId, 2_147_483_647);
  await expect(recovery.retry(command(eventId))).rejects.toMatchObject({
    code: 'ATTEMPT_LIMIT_REACHED',
  });
  expect((await recovery.inspect(address(eventId))).recoveryHistory).toEqual([]);
});

/** Проверяем запреты для разных состояний: живой lease, отсутствие dead,
 * выполненный marker и попытка обойти версию-предшественника. */
test('active lease, pending/processing/completed, marker and predecessor bypass cannot be administratively retried', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  await expect(recovery.retry(command(eventId))).rejects.toMatchObject({ code: 'NOT_DEAD' });
  const [claim] = await worker.claim();
  await expect(recovery.retry(command(eventId))).rejects.toMatchObject({ code: 'LEASE_ACTIVE' });
  expect(await worker.process(claim)).toBe('completed');
  await expect(recovery.retry(command(eventId))).rejects.toMatchObject({
    code: 'ALREADY_PROCESSED',
  });
  const later = await api.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (context) => {
    const input = outboxFixture();
    await api.get(OutboxService).append(context, input);
    return api.get(OutboxService).append(context, input);
  });
  await dead(later.eventId);
  await expect(recovery.retry(command(later.eventId))).rejects.toMatchObject({
    code: 'PREDECESSOR_REQUIRED',
  });
});

/** Отдельное соединение удерживает реальный FOR UPDATE до finally/ROLLBACK.
 * NOWAIT обязан отказать сразу, даже без активного lease; частичной истории быть не должно. */
test('active row lock is refused NOWAIT even when lease expired; no audit/history is written', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  await dead(eventId);
  const client = await database().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('select 1 from delivery_streams where aggregate_id=$1 for update', [
      document.id,
    ]);
    await expect(recovery.retry(command(eventId))).rejects.toMatchObject({ code: 'DELIVERY_BUSY' });
    expect((await recovery.inspect(address(eventId))).recoveryHistory).toEqual([]);
  } finally {
    await client.query('rollback');
    client.release();
  }
});

/** Два параллельных retry конкурируют за те же строки. Ровно один успешный commit
 * оставляет одну запись; неизменяемость истории проверяем DELETE/UPDATE/TRUNCATE. */
test('two operators cannot both retry same dead delivery; only one immutable administrative record remains', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  await dead(eventId);
  const results = await Promise.allSettled([
    recovery.retry(command(eventId)),
    recovery.retry(command(eventId)),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await recovery.inspect(address(eventId))).recoveryHistory).toHaveLength(1);
  for (const query of [
    'delete from outbox_recovery_actions',
    'update outbox_recovery_actions set previous_attempts=0',
    'truncate outbox_recovery_actions',
  ]) {
    await expect(database().connection.pool.query(query)).rejects.toMatchObject({ code: '42501' });
  }
});

/** AFTER-trigger по очереди падает после каждого существенного SQL-шага.
 * Удаляем fault в finally; повторное inspect должно увидеть исходный dead и пустую историю/аудит. */
test.each(['audit_entries', 'outbox_recovery_actions', 'outbox_deliveries', 'delivery_streams'])(
  'SQL fault after %s rolls back retry/history/audit',
  async (table) => {
    const { document } = await postedReceiptFixture(api);
    const eventId = document.postedEventId!;
    await dead(eventId);
    const pool = database().connection.pool;
    const operation = ['audit_entries', 'outbox_recovery_actions'].includes(table)
      ? 'insert'
      : 'update';
    await pool.query(
      "create function retry_fault() returns trigger language plpgsql as $$ begin raise exception 'fault'; end $$",
    );
    try {
      await pool.query(
        `create trigger retry_fault after ${operation} on ${table} for each row execute function retry_fault()`,
      );
      try {
        await expect(recovery.retry(command(eventId))).rejects.toThrow();
      } finally {
        await pool.query(`drop trigger retry_fault on ${table}`);
      }
    } finally {
      await pool.query('drop function retry_fault()');
    }
    expect(await recovery.inspect(address(eventId))).toMatchObject({
      status: 'dead',
      attempt: 1,
      retryAttemptBase: 0,
      recoveryHistory: [],
    });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from audit_entries where action='outbox.delivery-retry-scheduled'",
        )
      ).rows[0].n,
    ).toBe(0);
  },
);

/** SET LOCAL ROLE действует только внутри того же context и откатывается с транзакцией.
 * Проверяем runtime-запрет на уровне сервиса/SQL и разрешение admin без прав на складские таблицы. */
test('restricted runtime role cannot administer; admin group can recover without domain table grants', async () => {
  const { document } = await postedReceiptFixture(api);
  const eventId = document.postedEventId!;
  await dead(eventId);
  const runner = api.get<TransactionRunner>(TRANSACTION_RUNNER);
  const service = (role: string) =>
    new OutboxRecoveryService(
      {
        run: (work) =>
          runner.run(async (context) => {
            await transactionClient(context).execute(sql.raw(`set local role ${role}`));
            return work(context);
          }),
      },
      api.get(RecoveryRepository),
      api.get(AuditService),
    );
  await expect(service('warehouse_app').retry(command(eventId))).rejects.toMatchObject({
    code: 'ADMIN_ROLE_REQUIRED',
  });
  await expect(service('warehouse_app').inspect(address(eventId))).rejects.toMatchObject({
    code: 'ADMIN_ROLE_REQUIRED',
  });
  await expect(
    runner.run(async (context) => {
      await transactionClient(context).execute(sql`set local role warehouse_app`);
      await transactionClient(context).execute(
        sql`update outbox_deliveries set status='retry',retry_attempt_base=attempts`,
      );
    }),
  ).rejects.toThrow();
  expect(await service('warehouse_outbox_admin').retry(command(eventId))).toMatchObject({
    status: 'retry',
    attempt: 1,
  });
});

/** Неизвестные поля и подставленный текст ошибки недоверенные даже при валидном событии.
 * Preview фильтрует их; invalid schemaVersion скрывает весь payload. Пороги очереди дают alert. */
test('safe payload opt-in drops unknown fields, masks injected errors and invalid contract; signal catches age/backlog', async () => {
  const fact = await api.get<TransactionRunner>(TRANSACTION_RUNNER).run((context) =>
    api.get(OutboxService).append(
      context,
      outboxFixture({
        secret: 'do-not-print',
        payload: { ...outboxFixture().payload, secret: 'do-not-print' },
      }),
    ),
  );
  await database().connection.pool.query(
    "update outbox_deliveries set last_error='password=do-not-print'",
  );
  expect(JSON.stringify(await recovery.inspect(address(fact.eventId), true))).not.toContain(
    'do-not-print',
  );
  expect((await recovery.inspect(address(fact.eventId))).payload).toEqual({ omitted: true });
  expect((await recovery.inspect(address(fact.eventId))).lastError).toBe('REDACTED');
  expect(await recovery.signal({ deadLimit: 1, backlogLimit: 1, maxAgeSeconds: 60 })).toMatchObject(
    { status: 'alert', backlog: 1 },
  );
  // Временно отключаем immutable trigger только в disposable admin БД и намеренно портим
  // envelope/время. Проверяем redaction и возраст очереди; production writer так делать не может.
  const client = await database().connection.pool.connect();
  try {
    await client.query('begin');
    await client.query('alter table outbox_events disable trigger outbox_events_immutable');
    await client.query(
      "update outbox_events set created_at=clock_timestamp()-interval '120 seconds',envelope=jsonb_set(envelope,'{schemaVersion}','2')",
    );
    await client.query('alter table outbox_events enable trigger outbox_events_immutable');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  expect((await recovery.inspect(address(fact.eventId), true)).payload).toEqual({
    redacted: true,
    reason: 'CONTRACT_REJECTED',
  });
  expect(
    await recovery.signal({ deadLimit: 1, backlogLimit: 100, maxAgeSeconds: 60 }),
  ).toMatchObject({ status: 'alert' });
});

/** Недоступный URL нужен как доказательство порядка: отказ local guard должен возникнуть
 * до попытки подключения. Сообщение CLI не отражает неправильный аргумент пользователя. */
test.each([{ NODE_ENV: 'production' }, { OUTBOX_ADMIN_ENABLED: 'false' }])(
  'CLI denies mode %j before DB and rejects unsafe flags',
  async (env) => {
    const result = await cli(['signal'], {
      ...env,
      DATABASE_URL: 'postgresql://offline@127.0.0.1:1/db',
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe('LOCAL_ACCESS_REQUIRED');
    const invalid = await cli(['inspect', '--event', 'secret']);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).not.toContain('secret');
  },
);
