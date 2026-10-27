/** @file Child-only worker lifecycle fixture: technical либо настоящий putaway handler с IPC barriers для SIGTERM/crash. */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { LocalEventHandler } from '@backend/infrastructure/worker/dto/delivery.dto';
// Child не имеет Jest module mapper. Явно загружаем production dist, а не .test-dist/src.
const { WorkerModule } = require(resolve('dist/infrastructure/worker/worker.module'));
const { DATABASE_CONFIG } = require(resolve('dist/infrastructure/database/database.module'));
const { validateEnvironment } = require(resolve('dist/infrastructure/config/environment'));
const { WORKER_CONFIG, validateWorkerEnvironment } = require(resolve('dist/infrastructure/worker/worker.config'));
const { WORKER_HANDLERS } = require(resolve('dist/infrastructure/worker/services/handler-registry'));
const { transactionClient } = require(resolve('dist/infrastructure/database/postgres-transaction-runner'));
const { runWorkerProcess } = require(resolve('dist/infrastructure/worker/worker-process'));
const { WorkerService } = require(resolve('dist/infrastructure/worker/services/worker.service'));
const { InventoryService } = require(resolve('dist/modules/inventory/services/inventory.service'));
import type { DeliveryClaim } from '@backend/infrastructure/worker/dto/delivery.dto';

/** Child env изолирован от parent process.env; credentials не передаются в CLI args/stdout/IPC. */
async function start(): Promise<void> {
  const config = validateWorkerEnvironment(process.env);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  process.on('message', message => { if (message === 'release') release(); });
  const handler: LocalEventHandler = { destination: 'inventory.putaway', handle: async (context, event) => {
    await transactionClient(context).execute(sql`insert into application_metadata(key,value) values(${event.eventId},'1')`);
    // IPC и ожидание — только fault-injection test hook, не пример разрешённого I/O в DB handler.
    process.send?.('handling'); await barrier;
  } };
  await runWorkerProcess(async () => {
    const builder = Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(DATABASE_CONFIG).useValue(validateEnvironment(process.env))
      .overrideProvider(WORKER_CONFIG).useValue(config);
    const production = process.env.TEST_PUTAWAY_HANDLER === 'true';
    if (!production) builder.overrideProvider(WORKER_HANDLERS).useValue([handler]);
    const app = await builder.compile();
    await app.init();
    if (production) {
      const inventory = app.get(InventoryService); const create = inventory.createPutawayTasks.bind(inventory);
      // Тот же IPC hook, но после настоящих task/audit INSERT production inventory,
      // до marker/commit worker. Handler/SQL остаются реальными, добавляется только barrier.
      inventory.createPutawayTasks = async (...args: Parameters<typeof create>) => { const result = await create(...args); process.send?.('handling'); await barrier; return result; };
    }
    const worker = app.get(WorkerService); const original = worker.process.bind(worker);
    // IPC отмечает именно завершённый production COMMIT, не выход из handler callback.
    worker.process = async (claim: DeliveryClaim) => { const result = await original(claim); if (result === 'completed') process.send?.('committed'); return result; };
    return app;
  }, config);
  // IPC channel сам удерживает child event loop; после production close закрываем test-only channel.
  process.disconnect?.();
}
void start().catch(() => { process.exitCode = 1; process.disconnect?.(); });
