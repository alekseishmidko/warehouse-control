/** @file Отдельный opt-in publisher process: singleton PG session, Kafka transport и bounded signal drain. */
import './infrastructure/logging/startup';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvironment } from './infrastructure/config/environment';
import { createDatabaseConnection } from './infrastructure/database/connection';
import {
  validatePublisherEnvironment,
  PublisherConfigurationError,
} from './infrastructure/publisher/publisher.config';
import { PublisherRepository } from './infrastructure/publisher/repositories/publisher.repository';
import { PublisherService } from './infrastructure/publisher/services/publisher.service';
import { KafkaEventTransport } from './infrastructure/publisher/kafka-event.transport';
import { ProcessHealth } from './infrastructure/lifecycle/process-health';
import { logEvent } from './infrastructure/logging/runtime-logger';
import type { Server } from 'node:http';

/** Signal до/после startup прекращает новые ticks; deadline охватывает network/drain/close.
 * После DB session loss старый process не reconnect-ится; новый Kafka epoch fences in-flight transaction.
 */
export async function runPublisher(): Promise<void> {
  const env = loadEnvironment();
  // Opt-in означает публикацию всей retained history с версии1. Это не cutover local worker:
  // Kafka consumers и перенос незавершённых local deliveries относятся к WMS-504–506.
  const config = validatePublisherEnvironment(process.env);
  const connection = createDatabaseConnection(env.databaseUrl);
  let repository: PublisherRepository | undefined;
  const transport = new KafkaEventTransport(config);
  let stopped = false;
  let deadline: NodeJS.Timeout | undefined;
  let probes: Server | undefined;
  const wake = new AbortController();
  let health: ProcessHealth | undefined;
  const stop = () => {
    if (stopped) return;
    // Следующий tick не начнётся; текущая операция получает общий bounded drain.
    // При deadline ОС закроет sockets, а persisted attempt останется для восстановления.
    stopped = true;
    wake.abort();
    if (health) health.draining = true;
    deadline = setTimeout(() => {
      logEvent('publisher.shutdown_deadline');
      process.exit(1);
    }, config.shutdownMs);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  let closed = false;
  try {
    // Recreate/replicas1 не защищают от изолированного старого узла. Держим session lock
    // на том же соединении, через которое выполняются все publisher SQL; reconnect запрещён.
    repository = await PublisherRepository.acquire(connection.pool);
    if (stopped) return;
    await transport.connect();
    if (stopped) return;
    const owner = repository;
    // Kafka проверена при startup; дальнейшая readiness проверяет PG owner, а не
    // непрерывную доступность broker. Liveness остаётся независимой от внешних сервисов.
    health = new ProcessHealth(() => owner.assertReady());
    probes = await health.listen(config.healthPort);
    health.started = true;
    logEvent('publisher.ready');
    const service = new PublisherService(owner, transport);
    while (!stopped) {
      const result = await service.tick();
      if (result === 'idle') {
        try {
          await delay(config.pollMs, undefined, { signal: wake.signal });
        } catch {
          if (!stopped) throw new Error('Publisher wait failed');
        }
      }
    }
  } catch {
    process.exitCode = 1;
    logEvent('process.failed');
  } finally {
    stop();
    try {
      try {
        if (probes)
          await new Promise<void>((resolve, reject) =>
            probes!.close((error) => (error ? reject(error) : resolve())),
          );
      } finally {
        try {
          // Сначала закрываем Kafka, затем освобождаем PG owner; новый процесс не должен обгонять штатный drain.
          await transport.close();
        } finally {
          repository?.close();
          await connection.pool.end();
        }
      }
      closed = true;
    } catch {
      process.exitCode = 1;
      logEvent('process.failed');
    }
    if (closed && deadline) clearTimeout(deadline);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
if (require.main === module)
  void runPublisher().catch((error: unknown) => {
    // В конфигурации может случайно оказаться пароль: логируем только код из закрытого контракта.
    logEvent('process.failed', {
      errorCode:
        error instanceof PublisherConfigurationError ? error.errorCode : 'PUBLISHER_STARTUP_FAILED',
    });
    process.exitCode = 1;
  });
