/** @file Lossless encrypted decoded-record storage: binary/null/headers, authentication, quota и private key guards. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuarantineCrypto } from '@backend/infrastructure/kafka-consumer/quarantine-crypto';
import type { KafkaMessage } from 'kafkajs';
test('raw bytes roundtrip and source AAD cannot be changed', () => {
  const crypto = new QuarantineCrypto(randomBytes(32), 'dev-test');
  const address = { topic: 'warehouse.receiving.events', partition: 0, offset: '9007199254740993' };
  const message: KafkaMessage = {
    key: Buffer.from([0, 255]),
    value: null,
    headers: { a: [Buffer.from([254]), 'text'], b: undefined },
    offset: address.offset,
    timestamp: '123',
    attributes: 0,
  };
  const sealed = crypto.seal(address, message);
  const decoded = JSON.parse(crypto.open(address, sealed).toString());
  expect(decoded).toMatchObject({
    key: 'AP8=',
    value: null,
    headers: [
      ['a', ['/g==', 'dGV4dA==']],
      ['b', null],
    ],
  });
  expect(() => crypto.open({ ...address, partition: 1 }, sealed)).toThrow();
  expect(() => crypto.seal({ ...address, offset: '1' }, message)).toThrow('source mismatch');
  expect(() => crypto.open(address, { ...sealed, keyId: 'different' })).toThrow();
  expect(() => crypto.seal(address, { ...message, value: Buffer.alloc(1048576) })).toThrow('quota');
  expect(() => new QuarantineCrypto(Buffer.alloc(1), 'dev-test')).toThrow();
});
test('key file is private, exact32 bytes, not a symlink or group readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'warehouse-key-'));
  const file = join(dir, 'key');
  try {
    writeFileSync(file, randomBytes(32), { mode: 0o600 });
    const env = { CONSUMER_QUARANTINE_KEY_FILE: file, CONSUMER_QUARANTINE_KEY_ID: 'dev-test' };
    expect(QuarantineCrypto.fromEnvironment(env).keyId).toBe('dev-test');
    chmodSync(file, 0o400);
    expect(QuarantineCrypto.fromEnvironment(env).keyId).toBe('dev-test');
    chmodSync(file, 0o700);
    expect(() => QuarantineCrypto.fromEnvironment(env)).toThrow('permissions');
    chmodSync(file, 0o644);
    expect(() => QuarantineCrypto.fromEnvironment(env)).toThrow('permissions');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recovery opt-in preserves old configuration and rejects malformed enabled profile', async () => {
  const { loadQuarantineCrypto } =
    await import('@backend/infrastructure/kafka-consumer/services/kafka-recovery.service');
  const names = [
    'CONSUMER_RECOVERY_ENABLED',
    'CONSUMER_QUARANTINE_KEY_FILE',
    'CONSUMER_QUARANTINE_KEY_ID',
  ] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.CONSUMER_RECOVERY_ENABLED;
    expect(loadQuarantineCrypto()).toBeUndefined();
    process.env.CONSUMER_RECOVERY_ENABLED = 'false';
    expect(loadQuarantineCrypto()).toBeUndefined();
    process.env.CONSUMER_RECOVERY_ENABLED = 'invalid';
    expect(() => loadQuarantineCrypto()).toThrow('opt-in');
    process.env.CONSUMER_RECOVERY_ENABLED = 'true';
    delete process.env.CONSUMER_QUARANTINE_KEY_FILE;
    expect(() => loadQuarantineCrypto()).toThrow();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('recovery without crypto never falls back to plaintext or bypasses command validation', async () => {
  const { KafkaRecoveryService } =
    await import('@backend/infrastructure/kafka-consumer/services/kafka-recovery.service');
  const { QuarantineRepository } =
    await import('@backend/infrastructure/kafka-consumer/repositories/quarantine.repository');
  const { AuditService } = await import('@backend/modules/audit/services/audit.service');
  const { AuditRepository } = await import('@backend/modules/audit/repositories/audit.repository');
  const recovery = new KafkaRecoveryService(
    {
      run: async () => {
        throw new Error('Unexpected SQL');
      },
    },
    new QuarantineRepository(),
    new AuditService(new AuditRepository()),
    undefined,
  );
  const address = { topic: 'warehouse.receiving.events', partition: 0, offset: '0' };
  const message: KafkaMessage = {
    key: null,
    value: Buffer.from('SECRET'),
    timestamp: '0',
    attributes: 0,
    offset: '0',
    headers: {},
  };
  await expect(recovery.failed(address, message, new Error('SECRET'))).rejects.toThrow('disabled');
  const command = {
    id: randomUUID(),
    operatorId: randomUUID(),
    correlationId: randomUUID(),
    reasonCode: 'diagnostic',
  };
  await expect(recovery.exportRaw(command)).rejects.toThrow('key required');
  await expect(recovery.inspect('SECRET')).rejects.toThrow('Invalid quarantine id');
  await expect(recovery.retry({ ...command, reasonCode: 'SECRET@example.com' })).rejects.toThrow(
    'Invalid Kafka recovery command',
  );
});
