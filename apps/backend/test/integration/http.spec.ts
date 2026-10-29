/** @file Supertest suite настоящего Nest AppModule с отдельной migratеd БД и config override. */
import request from 'supertest';
import { useDatabaseSuite } from '../support/database-harness';
import { metadataFixture } from '../support/metadata.fixture';
import { applicationMetadata } from '@backend/infrastructure/database/schema';
import { DatabaseService } from '@backend/infrastructure/database/database.module';
import { sql } from 'drizzle-orm';

const database = useDatabaseSuite();

test('GET / and /health work with real database-backed application', async () => {
  const app = await database().createHttpApplication();
  const connected = await app
    .get(DatabaseService)
    .db.execute<{ name: string }>(sql`select current_database() as name`);
  expect(connected.rows[0].name).toBe(new URL(database().config.databaseUrl).pathname.slice(1));
  await request(app.getHttpServer()).get('/').expect(200).expect('Warehouse Controller API');
  await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  await request(app.getHttpServer()).get('/does-not-exist').expect(404);
  await app.close();
  const active = await database().connection.pool.query(
    "select count(*)::int as count from pg_stat_activity where datname=current_database() and application_name='warehouse-controller' and pid<>pg_backend_pid()",
  );
  expect(active.rows[0].count).toBe(0);
});

test('fixture data belongs only to this suite database', async () => {
  const fixture = metadataFixture();
  await database().connection.db.insert(applicationMetadata).values(fixture);
  expect(await database().connection.db.select().from(applicationMetadata)).toEqual([
    expect.objectContaining(fixture),
  ]);
});
