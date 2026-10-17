/** @file Реальная PostgreSQL suite: SQL migrations, commit/rollback и независимая очистка fixtures. */
import { eq } from 'drizzle-orm';
import { applicationMetadata } from '@backend/infrastructure/database/schema';
import { useDatabaseSuite } from '../support/database-harness';
import { metadataFixture } from '../support/metadata.fixture';

const database = useDatabaseSuite();

test('migrated PostgreSQL version matches Compose major and baseline exists', async () => {
  const { pool } = database().connection;
  const version = await pool.query("select current_setting('server_version_num')::int as version");
  expect(Math.floor(version.rows[0].version / 10000)).toBe(17);
  const journal = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
  expect(journal.rows[0].count).toBeGreaterThan(0);
  expect(await database().connection.db.select().from(applicationMetadata)).toEqual([]);
});

test('committed transaction is visible to a new query', async () => {
  const row = metadataFixture();
  const { db } = database().connection;
  await db.transaction(async tx => { await tx.insert(applicationMetadata).values(row); });
  expect(await db.select().from(applicationMetadata).where(eq(applicationMetadata.key, row.key)))
    .toEqual([expect.objectContaining(row)]);
});

test('exception rolls back an inserted row and releases transaction connection', async () => {
  const row = metadataFixture();
  const { db, pool } = database().connection;
  await expect(db.transaction(async tx => {
    await tx.insert(applicationMetadata).values(row);
    throw new Error('planned transaction failure');
  })).rejects.toThrow('planned transaction failure');
  expect(await db.select().from(applicationMetadata).where(eq(applicationMetadata.key, row.key))).toEqual([]);
  expect((await pool.query('select 1 as ok')).rows[0].ok).toBe(1);
});

test('suite cleanup preserves migration history', async () => {
  await database().connection.db.insert(applicationMetadata).values(metadataFixture());
  await database().reset();
  expect(await database().connection.db.select().from(applicationMetadata)).toEqual([]);
  expect((await database().connection.pool.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows[0].count).toBeGreaterThan(0);
});
