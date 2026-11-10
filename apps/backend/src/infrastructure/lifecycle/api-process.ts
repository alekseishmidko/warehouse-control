/** @file HTTP lifecycle: signal до startup, остановка приёма, drain до закрытия pool и общий deadline. */
import { logEvent } from '../logging/runtime-logger';
import type { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { ProcessHealth } from './process-health';
/** Grace Kubernetes 30s превышает общий API drain 20s и DB transaction timeout 10s. */
export const API_SHUTDOWN_TIMEOUT_MS = 20000;
/**
 * Владеет signal listeners и ресурсами API. После signal listener закрывается для новых connections;
 * существующие запросы завершаются до app.close/pool.end. Deadline закрывает sockets процесса,
 * PostgreSQL откатывает незавершённые transactions; committed result доступен по прежнему key.
 */
export async function runApiProcess(
  createApplication: () => Promise<INestApplication>,
  port: number,
  host: string,
): Promise<void> {
  let app: INestApplication | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let stopped = false;
  let wake: () => void = () => {};
  const signal = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (app) app.get(ProcessHealth).draining = true;
    deadline = setTimeout(() => {
      logEvent('api.shutdown_deadline');
      process.exit(1);
    }, API_SHUTDOWN_TIMEOUT_MS);
    wake();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    app = await createApplication();
    // Init может ждать PostgreSQL. Signal за это время должен запретить последующий bind,
    // поэтому отделяем init от listen и повторяем stop-проверку после await.
    if (!stopped) await app.init();
    if (!stopped) {
      await app.listen(port, host);
      logEvent('api.ready');
      await signal;
    }
    app.get(ProcessHealth).draining = true;
    const server: unknown = app.getHttpServer();
    if (!(server instanceof Server)) throw new Error('HTTP server required');
    // server.close ждёт active responses. Idle keep-alive sockets не удерживают завершение Node 24.
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  } finally {
    if (!stopped) stop();
    let closed = false;
    try {
      await app?.close();
      closed = true;
    } finally {
      // Rejected cleanup не доказывает освобождение sockets/pool. Deadline должен остаться
      // активным, чтобы ошибка close не превратилась в неограниченное зависание процесса.
      if (closed && deadline) clearTimeout(deadline);
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
    }
  }
}
