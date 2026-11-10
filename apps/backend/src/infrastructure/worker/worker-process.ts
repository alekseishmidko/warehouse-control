/** @file Process lifecycle: signal до/после startup, bounded drain и finally закрытие probes/Nest/pg без warehouse HTTP listener. */
import { logEvent } from '../logging/runtime-logger';
import type { Server } from 'node:http';
import { ProcessHealth } from '../lifecycle/process-health';
import { DatabaseService } from '../database/database.module';
import type { INestApplicationContext } from '@nestjs/common';
import type { WorkerConfig } from './worker.config';
import { WorkerLoop } from './services/worker-loop';
import { HandlerRegistry } from './services/handler-registry';

/**
 * Владеет context lifecycle и signal listeners; factory позволяет tests использовать тот же process protocol.
 * @param createApplication Создаёт/инициализирует только worker Nest graph, не app HTTP.
 * @param config Валидированный shutdown deadline, общий для drain и pool.close.
 * @returns После SIGTERM/SIGINT, drain и close; при startup/runtime ошибке устанавливает exitCode=1.
 * Hard deadline завершает процесс с code=1: ОС закрывает sockets и PostgreSQL откатывает открытые transactions.
 * CPU-blocking JS нельзя прервать timer: такие handlers запрещены, это не sandbox/лимит CPU.
 */
export async function runWorkerProcess(
  createApplication: () => Promise<INestApplicationContext>,
  config: WorkerConfig,
  healthPort = 9100,
): Promise<void> {
  let app: INestApplicationContext | undefined;
  let loop: WorkerLoop | undefined;
  let probes: Server | undefined;
  let health: ProcessHealth | undefined;
  let stopped = false;
  let deadline: NodeJS.Timeout | undefined;
  /** Signal обрабатывается один раз; повторный не начинает новый drain/timeout и не открывает новые claims. */
  const stop = () => {
    if (stopped) return;
    stopped = true;
    loop?.stop();
    if (health) health.draining = true;
    deadline = setTimeout(() => {
      logEvent('worker.shutdown_deadline');
      process.exit(1);
    }, config.shutdownTimeoutMs);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    app = await createApplication();
    health = new ProcessHealth(() => app!.get(DatabaseService).assertReady());
    probes = await health.listen(healthPort);
    health.started = true;
    health.draining = stopped;
    const activeLoop = app.get<WorkerLoop>(WorkerLoop);
    loop = activeLoop;
    if (stopped) activeLoop.stop();
    if (!app.get(HandlerRegistry).destinations().length) logEvent('worker.idle');
    logEvent('worker.ready');
    await activeLoop.run();
  } catch {
    process.exitCode = 1;
    logEvent('process.failed');
  } finally {
    // Тот же hard deadline охватывает close pool. При ошибке без signal тоже нужен предел.
    if (!stopped) stop();
    let closed = false;
    try {
      try {
        if (probes)
          await new Promise<void>((resolve, reject) =>
            probes!.close((error) => (error ? reject(error) : resolve())),
          );
      } finally {
        // Даже ошибка probe listener не должна пропустить закрытие DB pool.
        await app?.close();
      }
      closed = true;
    } catch {
      process.exitCode = 1;
      logEvent('process.failed');
    }
    // При rejected cleanup resources могут остаться открыты: hard deadline сохраняется.
    if (closed && deadline) clearTimeout(deadline);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
