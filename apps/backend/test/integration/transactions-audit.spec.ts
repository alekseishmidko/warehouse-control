/** @file Реальная PostgreSQL: общий context/atomic audit, rollback, scope/nesting и runtime append-only права. */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  PostgresTransactionRunner,
  transactionClient,
} from '@backend/infrastructure/database/postgres-transaction-runner';
import type {
  TransactionContext,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { TRANSACTION_RUNNER } from '@backend/shared/transactions/transaction.port';
import { applicationMetadata } from '@backend/infrastructure/database/schema';
import { auditEntries } from '@backend/modules/audit/audit.schema';
import { AuditRepository } from '@backend/modules/audit/repositories/audit.repository';
import { AuditService } from '@backend/modules/audit/services/audit.service';
import { useDatabaseSuite } from '../support/database-harness';
import { auditFixture } from '../support/audit.fixture';

const database = useDatabaseSuite();
const audit = new AuditService(new AuditRepository());

/** Test-only application interface surrogate до появления складских модулей: запись metadata в borrowed context. */
async function createTechnicalRecord(context: TransactionContext, key: string): Promise<string> {
  const client = transactionClient(context);
  await client.insert(applicationMetadata).values({ key, value: 'business-surrogate' });
  const result = await client.execute<{ id: string }>(sql`select txid_current()::text as id`);
  return result.rows[0].id;
}

test('one application context commits technical record and audit with no intermediate visibility', async () => {
  const { db } = database().connection;
  const runner = new PostgresTransactionRunner(db);
  const draft = auditFixture();
  const id = await runner.run(async (context) => {
    await transactionClient(context).execute(sql`set local role warehouse_app`);
    const transactionId = await createTechnicalRecord(context, draft.entityId);
    const auditId = await audit.write(context, draft);
    const sameTransaction = await transactionClient(context).execute<{ id: string }>(
      sql`select txid_current()::text as id`,
    );
    expect(sameTransaction.rows[0].id).toBe(transactionId);
    expect(await db.select().from(applicationMetadata)).toEqual([]);
    expect(await db.select().from(auditEntries)).toEqual([]);
    return auditId;
  });
  expect(await db.select().from(applicationMetadata)).toHaveLength(1);
  const [entry] = await db.select().from(auditEntries).where(eq(auditEntries.id, id));
  expect(entry).toMatchObject({
    actorId: draft.actorId,
    action: draft.action,
    correlationId: draft.correlationId,
  });
  expect(entry.occurredAt).toBeInstanceOf(Date);
});

test.each(['before-audit', 'after-audit', 'invalid-audit'])(
  'exception %s rolls back the entire scenario',
  async (failure) => {
    const { db } = database().connection;
    const runner = new PostgresTransactionRunner(db);
    const draft = auditFixture();
    await expect(
      runner.run(async (context) => {
        await createTechnicalRecord(context, draft.entityId);
        if (failure === 'before-audit') throw new Error('planned failure');
        await audit.write(
          context,
          failure === 'invalid-audit' ? { ...draft, actorId: 'invalid' } : draft,
        );
        if (failure === 'after-audit') throw new Error('planned failure');
      }),
    ).rejects.toThrow();
    expect(await db.select().from(applicationMetadata)).toEqual([]);
    expect(await db.select().from(auditEntries)).toEqual([]);
  },
);

test('nested run even through another runner is rejected and rolls back outer work', async () => {
  const { db } = database().connection;
  const runner = new PostgresTransactionRunner(db);
  const second = new PostgresTransactionRunner(db);
  await expect(
    runner.run(async (context) => {
      await createTechnicalRecord(context, randomUUID());
      await second.run(async () => undefined);
    }),
  ).rejects.toThrow('Nested transaction run is forbidden');
  expect(await db.select().from(applicationMetadata)).toEqual([]);
});

test('forged, cross-scope and completed contexts cannot be used', async () => {
  const { db } = database().connection;
  const runner = new PostgresTransactionRunner(db);
  let finished!: TransactionContext;
  await runner.run(async (context) => {
    finished = context;
  });
  expect(() => transactionClient(finished)).toThrow('inactive');
  await expect(audit.write({} as TransactionContext, auditFixture())).rejects.toThrow('inactive');
  await runner.run(async () => {
    await expect(audit.write(finished, auditFixture())).rejects.toThrow('inactive');
  });
});

test('rollback revokes context and the same runner can start a new root', async () => {
  const runner = new PostgresTransactionRunner(database().connection.db);
  let failed!: TransactionContext;
  await expect(
    runner.run(async (context) => {
      failed = context;
      throw new Error('planned scope failure');
    }),
  ).rejects.toThrow('planned scope failure');
  await expect(audit.write(failed, auditFixture())).rejects.toThrow('inactive');
  await expect(runner.run((context) => audit.write(context, auditFixture()))).resolves.toMatch(
    /^[0-9a-f-]{36}$/,
  );
});

test('independent concurrent roots receive different transactions and contexts', async () => {
  const runner = new PostgresTransactionRunner(database().connection.db);
  let first!: TransactionContext;
  let release!: () => void;
  let ready!: () => void;
  const firstReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstWork = runner.run(async (context) => {
    first = context;
    ready();
    await barrier;
    return createTechnicalRecord(context, randomUUID());
  });
  try {
    await firstReady;
    const secondId = await runner.run(async (context) => {
      expect(context).not.toBe(first);
      expect(() => transactionClient(first)).toThrow('scope');
      return createTechnicalRecord(context, randomUUID());
    });
    release();
    expect(await firstWork).not.toBe(secondId);
  } finally {
    release();
    await firstWork;
  }
});

test('audit redaction is applied before data reaches PostgreSQL', async () => {
  const runner = new PostgresTransactionRunner(database().connection.db);
  const draft = auditFixture({
    changes: { password: { after: 'never-store-me' }, status: { after: 'posted' } },
  });
  const id = await runner.run((context) => audit.write(context, draft));
  const [entry] = await database()
    .connection.db.select()
    .from(auditEntries)
    .where(eq(auditEntries.id, id));
  expect(entry.changes).toEqual({ status: { after: 'posted' } });
  expect(entry.hasRedactedChanges).toBe(true);
  expect(JSON.stringify(entry)).not.toContain('never-store-me');
});

test.each(['update', 'delete', 'truncate', 'disable-trigger'])(
  'runtime role cannot %s audit',
  async (operation) => {
    const runner = new PostgresTransactionRunner(database().connection.db);
    await runner.run((context) => audit.write(context, auditFixture()));
    const statements = {
      update: sql`update audit_entries set reason_code='changed'`,
      delete: sql`delete from audit_entries`,
      truncate: sql`truncate audit_entries`,
      'disable-trigger': sql`alter table audit_entries disable trigger audit_entries_append_only`,
    };
    let caught: unknown;
    try {
      await runner.run(async (context) => {
        await transactionClient(context).execute(sql`set local role warehouse_app`);
        await transactionClient(context).execute(statements[operation as keyof typeof statements]);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const codes: unknown[] = [];
    for (
      let error = caught as { code?: string; cause?: unknown } | undefined;
      error;
      error = error.cause as typeof error
    )
      codes.push(error.code);
    expect(codes).toContain('42501');
    expect(await database().connection.db.select().from(auditEntries)).toHaveLength(1);
  },
);

test.each(['update', 'delete', 'truncate'])(
  'trigger rejects ordinary %s even for table owner',
  async (operation) => {
    const { pool, db } = database().connection;
    await new PostgresTransactionRunner(db).run((context) => audit.write(context, auditFixture()));
    // Audit referenced by movements, tasks и recovery history: включаем весь FK graph,
    // чтобы проверить append-only trigger, а не отказ PostgreSQL FK precheck.
    // Recovery history тоже ссылается на audit: включаем полный FK-граф в TRUNCATE,
    // чтобы проверять именно append-only запрет 42501, а не ошибку отсутствующей FK-таблицы.
    const statements = {
      update: "update audit_entries set reason_code='changed'",
      delete: 'delete from audit_entries',
      truncate: 'truncate audit_entries, stock_movements, putaway_tasks, outbox_recovery_actions',
    };
    await expect(
      pool.query(statements[operation as keyof typeof statements]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await db.select().from(auditEntries)).toHaveLength(1);
  },
);

test.each(['40001', '40P01'])(
  'transaction runner does not automatically retry SQLSTATE %s',
  async (state) => {
    let attempts = 0;
    const runner = new PostgresTransactionRunner(database().connection.db);
    await expect(
      runner.run(async (context) => {
        attempts++;
        await createTechnicalRecord(context, randomUUID());
        // SQLSTATE берётся только из фиксированного test.each, не из пользовательского ввода.
        await transactionClient(context).execute(
          sql.raw(
            `do $$ begin raise exception 'planned transaction failure' using errcode='${state}'; end $$`,
          ),
        );
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(await database().connection.db.select().from(applicationMetadata)).toEqual([]);
  },
);

test('Nest exposes AuditService and the shared transaction runner', async () => {
  const app = await database().createHttpApplication();
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const writer = app.get(AuditService);
  const id = await runner.run((context) => writer.write(context, auditFixture()));
  expect(
    await database().connection.db.select().from(auditEntries).where(eq(auditEntries.id, id)),
  ).toHaveLength(1);
  await app.close();
});
