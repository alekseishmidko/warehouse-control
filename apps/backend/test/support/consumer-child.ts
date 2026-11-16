/** @file Test-only crash barrier: реальный DB commit уже прошёл, adapter ещё не получил разрешение offset commit. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { KafkaConsumerModule } from '../../src/infrastructure/kafka-consumer/kafka-consumer.module';
import { KafkaMessageService } from '../../src/infrastructure/kafka-consumer/services/kafka-message.service';
import { KafkaApplicationConsumer } from '../../src/infrastructure/kafka-consumer/kafka-consumer';
import { validateConsumerEnvironment } from '../../src/infrastructure/kafka-consumer/consumer.config';
async function main() {
  const app = await NestFactory.createApplicationContext(KafkaConsumerModule, {
    logger: false,
    abortOnError: false,
  });
  const messages = app.get(KafkaMessageService);
  const original = messages.process.bind(messages);
  messages.process = async (...args) => {
    const result = await original(...args);
    process.send?.('committed');
    await new Promise<void>(() => {});
    return result;
  };
  const consumer = new KafkaApplicationConsumer(validateConsumerEnvironment(process.env), messages);
  try {
    await consumer.start();
    await consumer.failure;
  } finally {
    await consumer.close();
    await app.close();
  }
}
void main().catch(() => {
  process.send?.('failed');
  process.exitCode = 1;
});
