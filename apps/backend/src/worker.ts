/** @file Отдельный executable worker: validated config, Nest application context без HTTP и bounded SIGTERM drain. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './infrastructure/worker/worker.module';
import { loadWorkerConfig } from './infrastructure/worker/worker.config';
import { runWorkerProcess } from './infrastructure/worker/worker-process';

/** Startup не выполняет migrations и не печатает DATABASE_URL/error payload; API запускается отдельной командой. */
async function bootstrapWorker(): Promise<void> {
  try {
    const config = loadWorkerConfig();
    await runWorkerProcess(() => NestFactory.createApplicationContext(WorkerModule, { logger: false, abortOnError: false }), config);
  } catch { process.exitCode = 1; console.error('Worker startup failed'); }
}
// Импорт файла инструментами не запускает polling; только executable entrypoint.
if (require.main === module) void bootstrapWorker();
