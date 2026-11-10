/** @file Отдельный executable worker: validated config, Nest context без бизнес-HTTP, probe listener9100 и bounded SIGTERM drain. */
import { logEvent } from './infrastructure/logging/runtime-logger';
import './infrastructure/logging/startup';
import 'reflect-metadata';
import { nestLogger } from './infrastructure/logging/runtime-logger';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './infrastructure/worker/worker.module';
import { loadWorkerConfig } from './infrastructure/worker/worker.config';
import { runWorkerProcess } from './infrastructure/worker/worker-process';

/** Startup не выполняет migrations и не печатает DATABASE_URL/error payload; API запускается отдельной командой. */
async function bootstrapWorker(): Promise<void> {
  try {
    const config = loadWorkerConfig();
    await runWorkerProcess(
      () =>
        NestFactory.createApplicationContext(WorkerModule, {
          logger: nestLogger,
          abortOnError: false,
        }),
      config,
    );
  } catch {
    process.exitCode = 1;
    logEvent('process.failed');
  }
}
// Импорт файла инструментами не запускает polling; только executable entrypoint.
if (require.main === module)
  bootstrapWorker().catch(() => {
    // Последняя граница executable: не допускает необработанный rejection и не печатает credentials.
    logEvent('process.failed');
    process.exitCode = 1;
  });
