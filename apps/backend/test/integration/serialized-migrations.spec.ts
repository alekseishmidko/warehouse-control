/** @file WMS-302: реальные journal/SQL migrations, DB wait barriers и освобождение lock при rollback. */
import { resolve, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { applySerializedMigrations } from '@backend/infrastructure/database/serialized-migrations';
import { useDatabaseSuite } from '../support/database-harness';
import { waitForDatabaseLock } from '../support/database-lock';
const database = useDatabaseSuite();

/** Синтетический новый SQL fact после production journal. Applied source/migrations не меняются. */
async function migrationFixture(sql: string) {
  const folder = await mkdtemp(join(tmpdir(), 'wms302-migration-'));
  try {
    const last = await database().connection.pool.query(
      'select max(created_at)::text as time from drizzle.__drizzle_migrations',
    );
    await mkdir(join(folder, 'meta'));
    await writeFile(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({
        entries: [{ tag: 'probe', when: Number(last.rows[0].time) + 1, breakpoints: true }],
      }),
    );
    await writeFile(join(folder, 'probe.sql'), sql);
    return folder;
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

test('parallel migrators wait before reading journal and execute new SQL exactly once', async () => {
  const { pool } = database().connection;
  const before = (
    await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations')
  ).rows[0].count;
  const folder = await migrationFixture(
    'create table migration_probe(id int primary key); insert into migration_probe values (1);',
  );
  const barrier = await pool.connect();
  let pending: Promise<void[]> | undefined;
  try {
    await barrier.query('select pg_advisory_lock(1464685363, 302)');
    pending = Promise.all([
      applySerializedMigrations(pool, folder),
      applySerializedMigrations(pool, folder),
    ]);
    const completed = expect(pending).resolves.toHaveLength(2);
    await waitForDatabaseLock(database(), 'pg_advisory_lock', 2);
    await barrier.query('select pg_advisory_unlock(1464685363, 302)');
    await completed;
    await applySerializedMigrations(pool, folder);
    expect((await pool.query('select * from migration_probe')).rows).toEqual([{ id: 1 }]);
    expect(
      (await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows[0]
        .count,
    ).toBe(before + 1);
  } finally {
    barrier.release(true);
    try {
      await pending;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
});

test('failed SQL rolls back DDL/journal and releases migration session lock', async () => {
  const { pool } = database().connection;
  const before = (await pool.query('select * from drizzle.__drizzle_migrations order by id')).rows;
  const folder = await migrationFixture(
    'create table rollback_probe(id int); --> statement-breakpoint\nselect 1/0;',
  );
  try {
    await expect(applySerializedMigrations(pool, folder)).rejects.toThrow();
    expect(
      (await pool.query("select to_regclass('public.rollback_probe') as probe")).rows[0].probe,
    ).toBeNull();
    expect(
      (await pool.query('select * from drizzle.__drizzle_migrations order by id')).rows,
    ).toEqual(before);
    await expect(applySerializedMigrations(pool, resolve('missing-migrations'))).rejects.toThrow();
    await applySerializedMigrations(pool, resolve('drizzle'));
    const probe = await pool.connect();
    try {
      expect(
        (await probe.query('select pg_try_advisory_lock(1464685363, 302) as acquired')).rows[0]
          .acquired,
      ).toBe(true);
    } finally {
      probe.release(true);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
