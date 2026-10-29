/** @file Process lifecycle: signal до/после startup, bounded drain и finally закрытие Nest/pg без HTTP listener. */
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
): Promise<void> {
  let app: INestApplicationContext | undefined;
  let loop: WorkerLoop | undefined;
  let stopped = false;
  let deadline: NodeJS.Timeout | undefined;
  /** Signal обрабатывается один раз; повторный не начинает новый drain/timeout и не открывает новые claims. */
  const stop = () => {
    if (stopped) return;
    stopped = true;
    loop?.stop();
    deadline = setTimeout(() => {
      console.error('Worker shutdown deadline exceeded');
      process.exit(1);
    }, config.shutdownTimeoutMs);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    app = await createApplication();
    const activeLoop = app.get<WorkerLoop>(WorkerLoop);
    loop = activeLoop;
    if (stopped) activeLoop.stop();
    if (!app.get(HandlerRegistry).destinations().length)
      console.info('Worker has no registered handlers; deliveries remain pending');
    console.info('Worker ready');
    await activeLoop.run();
  } catch {
    process.exitCode = 1;
    console.error('Worker lifecycle failed');
  } finally {
    // Тот же hard deadline охватывает close pool. При ошибке без signal тоже нужен предел.
    if (!stopped) stop();
    try {
      await app?.close();
    } catch {
      process.exitCode = 1;
      console.error('Worker resource cleanup failed');
    }
    if (deadline) clearTimeout(deadline);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
