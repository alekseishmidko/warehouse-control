/** @file Consumer config guards: opt-in, стабильные границы timeout и запрет plaintext/пустых credentials. */
import { validateConsumerEnvironment } from '@backend/infrastructure/kafka-consumer/consumer.config';
import { kafkaBrokers } from '@backend/infrastructure/kafka/kafka-connection.config';
test('consumer requires explicit retained-cursor opt-in and mTLS', () => {
  expect(() => validateConsumerEnvironment({})).toThrow('opt-in');
  expect(() =>
    validateConsumerEnvironment({ CONSUMER_ENABLED: 'true', CONSUMER_START: 'from-latest' }),
  ).toThrow('opt-in');
  expect(() =>
    validateConsumerEnvironment({ CONSUMER_ENABLED: 'true', CONSUMER_START: 'retained-cursor' }),
  ).toThrow();
  expect(() =>
    validateConsumerEnvironment({
      CONSUMER_ENABLED: 'true',
      CONSUMER_START: 'retained-cursor',
      CONSUMER_BROKERS: 'localhost:9093',
    }),
  ).toThrow();
});
test('shared broker guard rejects invalid ports and credentials', () => {
  expect(kafkaBrokers('broker:9093,broker-2:9094')).toEqual(['broker:9093', 'broker-2:9094']);
  for (const input of [
    undefined,
    '',
    'localhost:0',
    'localhost:65536',
    'user:pass@host:9093',
    'http://host:9093',
    'host:NaN',
  ])
    expect(() => kafkaBrokers(input)).toThrow();
});
