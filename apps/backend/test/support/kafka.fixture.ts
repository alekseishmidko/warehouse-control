/** @file Изолированный Kafka KRaft с обязательным mTLS; ephemeral certificates и данные удаляются после suite. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { GenericContainer, Wait } from 'testcontainers';
import { Kafka, logLevel } from 'kafkajs';
import { kafkaTopology } from '@backend/shared/events/generated/kafka-topology';
import type { PublisherConfig } from '@backend/infrastructure/publisher/publisher.config';
/** Реальные broker и TLS client; restart сохраняет тот же advertised port и broker storage. */
export async function createKafkaFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'warehouse-kafka-'));
  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-subj',
    '/CN=fixture-ca',
    '-days',
    '1',
  );
  for (const name of ['server', 'client']) {
    openssl(
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
      '-subj',
      `/CN=${name}`,
    );
    writeFileSync(
      join(directory, 'extensions'),
      'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth,clientAuth\n',
    );
    openssl(
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      'ca.crt',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${name}.crt`,
      '-days',
      '1',
      '-extfile',
      'extensions',
    );
    openssl('pkcs8', '-topk8', '-nocrypt', '-in', `${name}.key`, '-out', `${name}.pk8`);
  }
  const port = await availableLoopbackPort();
  const read = (name: string) => readFileSync(join(directory, name));
  const config: PublisherConfig = {
    brokers: [`127.0.0.1:${port}`],
    transactionalId: 'warehouse-outbox-publisher',
    ssl: {
      ca: read('ca.crt'),
      cert: read('client.crt'),
      key: read('client.key'),
      rejectUnauthorized: true,
    },
    requestTimeoutMs: 1000,
    pollMs: 50,
    shutdownMs: 45000,
    healthPort: 9101,
  };
  try {
    const container = await new GenericContainer(
      'apache/kafka:4.3.2@sha256:852a0d49fc4e656b022e7f23785411802c9a088c78a7c5e39f33969de9c227a7',
    )
      .withExposedPorts({ container: 9092, host: port })
      .withCopyContentToContainer([
        {
          target: '/tmp/server.pem',
          content: Buffer.concat([read('server.pk8'), read('server.crt')]),
          mode: 0o644,
        },
        { target: '/tmp/ca.crt', content: read('ca.crt'), mode: 0o644 },
      ])
      .withEnvironment({
        KAFKA_NODE_ID: '1',
        KAFKA_PROCESS_ROLES: 'broker,controller',
        KAFKA_CONTROLLER_QUORUM_VOTERS: '1@127.0.0.1:9093',
        KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'TLS:SSL,INTRA:SSL,CONTROLLER:PLAINTEXT',
        KAFKA_LISTENERS: 'TLS://0.0.0.0:9092,INTRA://0.0.0.0:9094,CONTROLLER://0.0.0.0:9093',
        KAFKA_ADVERTISED_LISTENERS: `TLS://127.0.0.1:${port},INTRA://localhost:9094`,
        KAFKA_INTER_BROKER_LISTENER_NAME: 'INTRA',
        KAFKA_SSL_KEYSTORE_TYPE: 'PEM',
        KAFKA_SSL_KEYSTORE_LOCATION: '/tmp/server.pem',
        KAFKA_SSL_TRUSTSTORE_TYPE: 'PEM',
        KAFKA_SSL_TRUSTSTORE_LOCATION: '/tmp/ca.crt',
        KAFKA_SSL_CLIENT_AUTH: 'required',
        KAFKA_MIN_INSYNC_REPLICAS: '1',
        KAFKA_DEFAULT_REPLICATION_FACTOR: '1',
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
        KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
        KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
        KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
        KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false',
        KAFKA_HEAP_OPTS: '-Xmx256M -Xms256M',
      })
      .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
      .withStartupTimeout(120000)
      .start();
    const kafka = new Kafka({
      brokers: config.brokers,
      ssl: config.ssl,
      logLevel: logLevel.NOTHING,
      retry: { retries: 1 },
    });
    const admin = kafka.admin();
    try {
      await admin.connect();
      await admin.createTopics({
        waitForLeaders: true,
        topics: Object.values(kafkaTopology).map((route) => ({
          topic: route.topic,
          numPartitions: 3,
          replicationFactor: 1,
        })),
      });
    } catch (error) {
      await container.stop();
      throw error;
    } finally {
      await admin.disconnect();
    }
    return {
      config,
      kafka,
      directory,
      container,
      async dispose() {
        try {
          await container.stop();
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Выбирает свободный host port; при гонке bind падает явно, fallback не используется. */
export async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No Kafka test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
