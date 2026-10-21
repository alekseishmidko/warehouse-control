/** @file Изолированная Testcontainers БД на suite: реальные migrations и LIFO cleanup даже после ошибки. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@backend/app.module';
import { validateEnvironment, RuntimeConfig } from '@backend/infrastructure/config/environment';
import { createDatabaseConnection } from '@backend/infrastructure/database/connection';
import { DATABASE_CONFIG } from '@backend/infrastructure/database/database.module';

const STARTUP_TIMEOUT_MS = 60000;
const CLEANUP_TIMEOUT_MS = 15000;

/** Подключение отдельной suite; dispose закрывает HTTP, pools и только её контейнер. */
export interface DatabaseHarness {
  readonly connection: ReturnType<typeof createDatabaseConnection>;
  readonly config: RuntimeConfig;
  readonly containerId: string;
  readonly closed: boolean;
  /** Запускает настоящий AppModule с config override; env/Compose и исходный startup не меняются. */
  createHttpApplication(): Promise<INestApplication>;
  /** Очищает только fixture data этой suite; migration journal остаётся. Не для concurrent tests одной suite. */
  reset(): Promise<void>;
  /** Идемпотентно закрывает все зарегистрированные ресурсы; ошибка cleanup не скрывается. */
  dispose(): Promise<void>;
}

/** Берёт exact image из Compose — один источник версии и digest PostgreSQL. Не читает .env. */
function postgresImage(): string {
  const compose = readFileSync(resolve('../../infra/compose/compose.yaml'), 'utf8');
  const image = compose.match(/^\s+image:\s*(postgres:\S+)\s*$/m)?.[1];
  if (!image) throw new Error('PostgreSQL image not found in Compose definition');
  return image;
}

/** Ограничивает ожидание cleanup; истечение timeout — ошибка, не успешное освобождение. */
async function boundedCleanup(cleanup: () => Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      cleanup(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Integration cleanup timed out')), CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Запускает новую БД и SQL migrations. Ошибка Docker/setup падает явно; skip/fallback на dev БД нет. */
export async function createDatabaseHarness(): Promise<DatabaseHarness> {
  let container: StartedPostgreSqlContainer | undefined;
  let connection: ReturnType<typeof createDatabaseConnection> | undefined;
  const cleanups: Array<() => Promise<unknown>> = [];
  let disposal: Promise<void> | undefined;
  let closed = false;

  const dispose = (): Promise<void> => disposal ??= (async () => {
    let failed = false;
    for (const cleanup of [...cleanups].reverse()) {
      try { await boundedCleanup(cleanup); }
      catch { failed = true; }
    }
    if (failed) throw new Error('Integration cleanup failed; inspect Testcontainers resources');
    closed = true;
  })();

  try {
    container = await new PostgreSqlContainer(postgresImage())
      .withDatabase(`suite_${randomUUID().replaceAll('-', '')}`)
      .withUsername('integration')
      .withPassword(randomUUID())
      .withLabels({ 'warehouse-controller.test': 'integration' })
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();
    const started = container;
    cleanups.push(() => started.stop({ timeout: 10000, remove: true, removeVolumes: true }));
    const config = validateEnvironment({ NODE_ENV: 'test', PORT: '3000', DATABASE_URL: started.getConnectionUri() });
    connection = createDatabaseConnection(config.databaseUrl);
    const database = connection;
    cleanups.push(() => database.pool.end());
    await migrate(database.db, { migrationsFolder: resolve('drizzle') });

    return {
      connection: database, config, containerId: started.getId(),
      get closed() { return closed; },
      async createHttpApplication() {
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(DATABASE_CONFIG).useValue(config).compile();
        let app: INestApplication | undefined;
        cleanups.push(() => app ? app.close() : moduleRef.close());
        app = moduleRef.createNestApplication({ logger: false });
        await app.init();
        return app;
      },
      async reset() {
        // Только администратор disposable test container может обходить append-only для cleanup.
        await database.db.transaction(async tx => {
          await tx.execute(sql`alter table audit_entries disable trigger audit_entries_append_only`);
          await tx.execute(sql`alter table stock_movements disable trigger stock_movements_append_only`);
          await tx.execute(sql`alter table outbox_events disable trigger outbox_events_immutable`);
          await tx.execute(sql`alter table outbox_deliveries disable trigger outbox_deliveries_retained`);
          await tx.execute(sql`alter table delivery_streams disable trigger delivery_streams_retained`);
          await tx.execute(sql`alter table outbox_aggregate_sequences disable trigger outbox_aggregate_sequences_retained`);
          await tx.execute(sql`truncate table application_metadata, audit_entries, stock_movements, stock_balances,
            locations, products, warehouses, outbox_deliveries, outbox_events, delivery_streams, outbox_aggregate_sequences`);
          await tx.execute(sql`alter table outbox_aggregate_sequences enable trigger outbox_aggregate_sequences_retained`);
          await tx.execute(sql`alter table delivery_streams enable trigger delivery_streams_retained`);
          await tx.execute(sql`alter table outbox_deliveries enable trigger outbox_deliveries_retained`);
          await tx.execute(sql`alter table outbox_events enable trigger outbox_events_immutable`);
          await tx.execute(sql`alter table stock_movements enable trigger stock_movements_append_only`);
          await tx.execute(sql`alter table audit_entries enable trigger audit_entries_append_only`);
        });
      },
      dispose,
    };
  } catch {
    try { await dispose(); }
    catch { throw new Error('Integration setup and cleanup failed; check Docker/Testcontainers resources'); }
    throw new Error('Integration setup failed: Docker must be available and PostgreSQL migrations must succeed');
  }
}

/** Scope для тестов отказа: cleanup выполняется при исключении/assertion из callback. */
export async function withDatabaseHarness<T>(work: (harness: DatabaseHarness) => Promise<T>): Promise<T> {
  const harness = await createDatabaseHarness();
  try { return await work(harness); }
  finally { await harness.dispose(); }
}

/** Jest suite lifecycle: контейнер на файл, очистка после теста и обязательное освобождение после suite. */
export function useDatabaseSuite(): () => DatabaseHarness {
  let harness: DatabaseHarness | undefined;
  beforeAll(async () => { harness = await createDatabaseHarness(); }, 120000);
  afterEach(async () => { if (harness) await harness.reset(); });
  afterAll(async () => { if (harness) await harness.dispose(); }, 60000);
  return () => {
    if (!harness) throw new Error('Integration harness is not initialized');
    return harness;
  };
}
