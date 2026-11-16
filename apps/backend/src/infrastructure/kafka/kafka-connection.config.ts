/** @file Общие Kafka mTLS/broker guards для publisher и consumer; без plaintext и без вывода credentials. */
import { readFileSync } from 'node:fs';
import { createSecureContext, type ConnectionOptions } from 'node:tls';
/** Причина не содержит исходный адрес, filesystem path или PEM. */
export class KafkaConnectionError extends Error {
  constructor(readonly reason: 'brokers' | 'tls') {
    super('Kafka connection configuration invalid');
  }
}
/** Брокеры задаются явно, порт 1..65535; broker hostname проверяет TLS stack при подключении. */
export function kafkaBrokers(value: string | undefined): string[] {
  const brokers = value?.split(',') ?? [];
  if (
    !brokers.length ||
    brokers.some(
      (b) =>
        !/^[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(b) ||
        Number(b.split(':')[1]) < 1 ||
        Number(b.split(':')[1]) > 65535,
    )
  )
    throw new KafkaConnectionError('brokers');
  return brokers;
}
/** Файлы читаются один раз при startup; rotations требуют перезапуска. Проверка server trust обязательна. */
export function kafkaTls(
  ca: string | undefined,
  cert: string | undefined,
  key: string | undefined,
): ConnectionOptions {
  try {
    const options = {
      ca: readFileSync(ca ?? ''),
      cert: readFileSync(cert ?? ''),
      key: readFileSync(key ?? ''),
      rejectUnauthorized: true,
    };
    createSecureContext(options);
    return options;
  } catch {
    throw new KafkaConnectionError('tls');
  }
}
