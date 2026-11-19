/** @file Test-only executable: запускает прежние API services и worker из isolated release checkout.
 * DATABASE_URL указывает только на disposable harness. Secrets не выводятся; stdout содержит metadata.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
/** Проверяет старый application graph после новой schema: receipt/stock/outbox и worker task commit. */
async function main(): Promise<void> {
  const root = process.env.WMS_RELEASE_BASE_DIRECTORY;
  if (!root) throw new Error('Release fixture directory required');
  const load = createRequire(resolve(root, 'apps/backend/package.json'));
  const { Test } = load('@nestjs/testing');
  load('reflect-metadata');
  const src = (file: string) => load(resolve(root, 'apps/backend/dist', file));
  const { AppModule } = src('app.module.js');
  const { WorkerModule } = src('infrastructure/worker/worker.module.js');
  const { DATABASE_CONFIG } = src('infrastructure/database/database.module.js');
  const { validateEnvironment } = src('infrastructure/config/environment.js');
  const { IDENTITY_CONFIG, validateIdentityConfig } = src('modules/identity/identity.config.js');
  const { TRANSACTION_RUNNER } = src('shared/transactions/transaction.port.js');
  const { CatalogService } = src('modules/catalog/services/catalog.service.js');
  const { WarehousesService } = src('modules/warehouses/services/warehouses.service.js');
  const { ReceivingService } = src('modules/receiving/services/receiving.service.js');
  const { WorkerService } = src('infrastructure/worker/services/worker.service.js');
  const { createDevWarehouseFixtures } = src('infrastructure/database/dev-fixtures.js');
  const app = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CONFIG)
    .useValue(validateEnvironment(process.env))
    .overrideProvider(IDENTITY_CONFIG)
    .useValue(
      validateIdentityConfig({
        NODE_ENV: 'test',
        AUTH_ORIGIN: 'http://127.0.0.1:3000',
        AUTH_SESSION_ABSOLUTE_SECONDS: '600',
        AUTH_SESSION_IDLE_SECONDS: '300',
      }),
    )
    .compile();
  let worker: { close(): Promise<void>; get(token: unknown): unknown } | undefined;
  try {
    await app.init();
    // Это test-only динамическая граница двух releases. Типы borrowed context задаёт
    // прежний runner; текущий TransactionContext не переносится между builds.
    const result = await app.get(TRANSACTION_RUNNER).run(async (context: unknown) => {
      const refs = await createDevWarehouseFixtures(
        context,
        app.get(CatalogService),
        app.get(WarehousesService),
      );
      const receiving = app.get(ReceivingService);
      const draft = await receiving.create(
        context,
        {
          warehouseId: refs.warehouse.id,
          receivingLocationId: refs.receiving.id,
          lines: [{ productId: refs.product.id, quantity: 10 }],
        },
        refs.metadata,
      );
      return receiving.post(context, draft.id, refs.metadata);
    });
    const graph = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(DATABASE_CONFIG)
      .useValue(validateEnvironment(process.env))
      .compile();
    worker = graph;
    await graph.init();
    const service = graph.get(WorkerService);
    const claims = await service.claim();
    for (const claim of claims)
      if ((await service.process(claim)) !== 'completed') throw new Error('Previous worker failed');
    process.stdout.write(
      JSON.stringify({ receiptId: result.id, eventId: result.postedEventId }) + '\n',
    );
  } finally {
    try {
      await worker?.close();
    } finally {
      await app.close();
    }
  }
}
main().catch(() => {
  process.stderr.write('Previous release runtime failed\n');
  process.exitCode = 1;
});
