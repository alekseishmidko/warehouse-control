/** @file ADR-0036: lossless decoded record snapshot, AES-256-GCM и отдельный private key file; без plaintext fallback. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import type { KafkaMessage } from 'kafkajs';
import type { KafkaAddress } from './dto/quarantine.dto';
/** Ciphertext transport DTO; nonce/tag обеспечивают authenticated encryption, digest — сверку повторных records. */
export type SealedRecord = {
  ciphertext: string;
  nonce: string;
  tag: string;
  digest: string;
  bytes: number;
  keyId: string;
};
/** Ключ читается до DB run; bytes не выводятся и не сохраняются в конфигурационных manifests. */
export class QuarantineCrypto {
  constructor(
    private readonly key: Buffer,
    readonly keyId: string,
  ) {
    if (key.length !== 32 || !/^[a-z][a-z0-9.-]{0,63}$/.test(keyId))
      throw new Error('Invalid quarantine key');
  }
  /** Только regular file0600/0400 текущего uid, без symlink; ключ — ровно32 random bytes. */
  static fromEnvironment(env: NodeJS.ProcessEnv): QuarantineCrypto {
    const fd = openSync(
      env.CONSUMER_QUARANTINE_KEY_FILE ?? '',
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        ![0o400, 0o600].includes(stat.mode & 0o777) ||
        stat.uid !== process.getuid?.() ||
        stat.size !== 32
      )
        throw new Error('Invalid quarantine key permissions');
      return new QuarantineCrypto(readFileSync(fd), env.CONSUMER_QUARANTINE_KEY_ID ?? '');
    } finally {
      closeSync(fd);
    }
  }
  /** AAD связывает encrypted bytes с source address; перенос ciphertext на другой offset не проходит verification. */
  seal(address: KafkaAddress, message: KafkaMessage): SealedRecord {
    if (address.offset !== message.offset) throw new Error('Kafka raw source mismatch');
    const encoded = (value: Buffer | string | null) =>
      value === null ? null : Buffer.from(value).toString('base64');
    const raw = Buffer.from(
      JSON.stringify({
        topic: address.topic,
        partition: address.partition,
        offset: address.offset,
        key: encoded(message.key),
        value: encoded(message.value),
        timestamp: message.timestamp,
        attributes: message.attributes,
        headers: Object.entries(message.headers ?? {}).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.map(encoded) : encoded(value ?? null),
        ]),
      }),
    );
    // Квота относится к полному lossless snapshot, включая base64 overhead. Ничего не обрезаем.
    if (raw.length > 1048576) throw new Error('Quarantine record quota exceeded');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([address.topic, address.partition, address.offset])));
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      digest: createHash('sha256').update(raw).digest('hex'),
      bytes: raw.length,
      keyId: this.keyId,
    };
  }
  /** Вызывается только явным audited admin export; результат не предназначен stdout/logger. */
  open(address: KafkaAddress, record: SealedRecord): Buffer {
    if (record.keyId !== this.keyId) throw new Error('Quarantine key unavailable');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.nonce, 'base64'));
    cipher.setAAD(Buffer.from(JSON.stringify([address.topic, address.partition, address.offset])));
    cipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(record.ciphertext, 'base64')), cipher.final()]);
  }
}
