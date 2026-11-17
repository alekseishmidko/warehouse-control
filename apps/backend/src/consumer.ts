/** @file Opt-in Kafka consumer process: общий Nest graph, probes, fail-stop и bounded SIGTERM drain. */
import './infrastructure/logging/startup';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server } from 'node:http';
import { KafkaRecoveryService } from './infrastructure/kafka-consumer/services/kafka-recovery.service';
import { KafkaConsumerModule } from './infrastructure/kafka-consumer/kafka-consumer.module';
import { KafkaApplicationConsumer } from './infrastructure/kafka-consumer/kafka-consumer';
import { KafkaMessageService } from './infrastructure/kafka-consumer/services/kafka-message.service';
import { validateConsumerEnvironment } from './infrastructure/kafka-consumer/consumer.config';
import { ProcessHealth } from './infrastructure/lifecycle/process-health';
import { DatabaseService } from './infrastructure/database/database.module';
import { logEvent } from './infrastructure/logging/runtime-logger';
import { nestLogger } from './infrastructure/logging/runtime-logger';
/** Реальный запуск не меняет local deliveries и не выполняет migrations/cutover автоматически. */
export async function runConsumer(): Promise<void> {
  const config = validateConsumerEnvironment(process.env);
  let app: INestApplicationContext | undefined;
  let consumer: KafkaApplicationConsumer | undefined;
  let probes: Server | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let health: ProcessHealth | undefined;
  let stopped = false;
  let signal!: () => void;
  const stopping = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    consumer?.stop();
    if (health) health.draining = true;
    signal();
    deadline = setTimeout(() => {
      logEvent('process.failed');
      process.exit(1);
    }, config.shutdownMs);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  let closed = false;
  try {
    app = await NestFactory.createApplicationContext(KafkaConsumerModule, {
      logger: nestLogger,
      abortOnError: false,
    });
    if (stopped) return;
    consumer = new KafkaApplicationConsumer(
      config,
      app.get(KafkaMessageService),
      app.get(KafkaRecoveryService),
    );
    await consumer.start();
    if (stopped) return;
    const database = app.get(DatabaseService);
    health = new ProcessHealth(async () => {
      if (!consumer!.ready) throw new Error('Consumer assignment unavailable');
      await database.assertReady();
    });
    probes = await health.listen(config.healthPort);
    health.started = true;
    logEvent('consumer.ready');
    await Promise.race([stopping, consumer.failure]);
  } catch {
    process.exitCode = 1;
    logEvent('process.failed', { errorCode: 'CONSUMER_FAILED' });
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
          await consumer?.close();
        } finally {
          await app?.close();
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
  void runConsumer().catch(() => {
    logEvent('process.failed', { errorCode: 'CONSUMER_STARTUP_FAILED' });
    process.exitCode = 1;
  });
