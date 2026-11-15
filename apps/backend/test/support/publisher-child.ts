/** @file Только тестовый crash barrier: child сообщает broker ack, не позволяет записать SQL completion и ждёт SIGKILL. */
import { createDatabaseConnection } from '../../src/infrastructure/database/connection';
import { validatePublisherEnvironment } from '../../src/infrastructure/publisher/publisher.config';
import { PublisherRepository } from '../../src/infrastructure/publisher/repositories/publisher.repository';
import { KafkaEventTransport } from '../../src/infrastructure/publisher/kafka-event.transport';
import { PublisherService } from '../../src/infrastructure/publisher/services/publisher.service';
/** Parent управляет ресурсами stand; IPC не добавлен в production entrypoint. */
async function main() {
  const connection = createDatabaseConnection(process.env.DATABASE_URL!);
  const repository = await PublisherRepository.acquire(connection.pool);
  const transport = new KafkaEventTransport(validatePublisherEnvironment(process.env));
  try {
    await transport.connect();
    await new PublisherService(repository, {
      connect: async () => {},
      close: async () => {},
      publish: async (event) => {
        if (process.env.TEST_CRASH_PHASE === 'after-ack') await transport.publish(event);
        process.send?.('barrier');
        await new Promise<void>(() => {});
      },
    }).tick();
  } finally {
    try {
      await transport.close();
    } finally {
      repository.close();
      await connection.pool.end();
    }
  }
}
void main().catch(() => {
  process.send?.('failed');
  process.exitCode = 1;
});
