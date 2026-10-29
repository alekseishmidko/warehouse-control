/** @file Failure/parallel lifecycle: исключение callback освобождает HTTP/pool/container, БД изолированы. */
import { applicationMetadata } from '@backend/infrastructure/database/schema';
import { DatabaseHarness, withDatabaseHarness } from '../support/database-harness';
import { metadataFixture } from '../support/metadata.fixture';

test('callback assertion failure still releases every owned resource', async () => {
  let captured: DatabaseHarness | undefined;
  await expect(
    withDatabaseHarness(async (harness) => {
      captured = harness;
      await harness.createHttpApplication();
      await harness.connection.db.insert(applicationMetadata).values(metadataFixture());
      expect('actual').toBe('deliberately different');
    }),
  ).rejects.toThrow();
  expect(captured).toBeDefined();
  expect(captured!.closed).toBe(true);
  expect(captured!.connection.pool.ended).toBe(true);
  await expect(captured!.connection.pool.query('select 1')).rejects.toThrow();
  await expect(captured!.dispose()).resolves.toBeUndefined();
});

test('two live harnesses accept identical fixture keys without sharing data', async () => {
  await withDatabaseHarness(async (first) => {
    await withDatabaseHarness(async (second) => {
      expect(first.containerId).not.toBe(second.containerId);
      const row = metadataFixture({ key: 'same-key', value: 'first' });
      await Promise.all([
        first.connection.db.insert(applicationMetadata).values(row),
        second.connection.db.insert(applicationMetadata).values({ ...row, value: 'second' }),
      ]);
      expect((await first.connection.db.select().from(applicationMetadata))[0].value).toBe('first');
      expect((await second.connection.db.select().from(applicationMetadata))[0].value).toBe(
        'second',
      );
      await first.reset();
      expect(await first.connection.db.select().from(applicationMetadata)).toEqual([]);
      expect((await second.connection.db.select().from(applicationMetadata))[0].value).toBe(
        'second',
      );
    });
  });
});
