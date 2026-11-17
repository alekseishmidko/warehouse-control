/** @file Владелец Kafka quarantine/admin transactions: encrypted I/O до run, durable gate и AuditService в общем context. */
import { logEvent } from '../../logging/runtime-logger';
import { Inject, Injectable } from '@nestjs/common';
import type { KafkaMessage } from 'kafkajs';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
  type TransactionContext,
} from '../../../shared/transactions/transaction.port';
import { isUuid } from '../../../shared/validation/identifiers';
import { AuditService } from '../../../modules/audit/services/audit.service';
import { StaleDeliveryError } from '../../worker/delivery-policy';
import { classifyDeliveryError } from '../../worker/delivery-policy';
import { QuarantineCrypto } from '../quarantine-crypto';
import { QuarantineRepository, PartitionBlockedError } from '../repositories/quarantine.repository';
import type { KafkaAddress, KafkaRecoveryCommand } from '../dto/quarantine.dto';
/** Config factory включает storage только явным opt-in; старый consumer без ключа сохраняет WMS-504 fail-stop. */
export const QUARANTINE_CRYPTO = Symbol('QUARANTINE_CRYPTO');
/** Создаёт crypto до транзакций; malformed opt-in не даёт silently отключить recovery. */
export function loadQuarantineCrypto(): QuarantineCrypto | undefined {
  const flag = process.env.CONSUMER_RECOVERY_ENABLED;
  if (flag === undefined || flag === 'false') return undefined;
  if (flag !== 'true') throw new Error('Invalid Kafka recovery opt-in');
  return QuarantineCrypto.fromEnvironment(process.env);
}
/** Application consumer остаётся отдельным capability; этот service не вызывает складской handler. */
@Injectable()
export class KafkaRecoveryService {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
    private readonly repository: QuarantineRepository,
    private readonly audit: AuditService,
    @Inject(QUARANTINE_CRYPTO) private readonly crypto: QuarantineCrypto | undefined,
  ) {}
  /** Проверяемый adapter feature switch, не право обходить enabled gate. */
  get enabled(): boolean {
    return this.crypto !== undefined;
  }
  /** Синхронная с business commit SQL gate; вызывается внутри его transaction. */
  async guard(context: TransactionContext, address: KafkaAddress): Promise<void> {
    await this.repository.check(context, address);
  }
  /** Проверяет gate ещё до schema validation; blocked malformed record не тратит новый retry budget. */
  async check(address: KafkaAddress): Promise<void> {
    await this.transactions.run((tx) => this.repository.check(tx, address));
  }
  /** Poll pause/restart после retry deadline либо explicit admin retry; raw не загружается. */
  async ready(address: KafkaAddress): Promise<boolean> {
    try {
      await this.check(address);
      return true;
    } catch (error) {
      if (error instanceof PartitionBlockedError) return false;
      throw error;
    }
  }
  /** После rollback только безопасный error code; oversized/crypto/quota/DB failure запрещают ack и останавливают process. */
  async failed(
    address: KafkaAddress,
    message: KafkaMessage,
    error: unknown,
    isOwned: () => boolean = () => true,
  ): Promise<void> {
    if (!this.crypto) throw new Error('Kafka recovery disabled');
    const sealed = this.crypto.seal(address, message);
    let eventId: string | null = null;
    try {
      const body: unknown = JSON.parse(message.value?.toString('utf8') ?? 'null');
      if (body && typeof body === 'object' && 'eventId' in body && isUuid(body.eventId))
        eventId = String(body.eventId).toLowerCase();
    } catch {
      /* Malformed record остаётся ciphertext; JSON excerpt не отражается. */
    }
    const policy = classifyDeliveryError(error);
    const saved = await this.transactions.run(async (tx) => {
      if (!isOwned()) throw new StaleDeliveryError();
      const result = await this.repository.fail(
        tx,
        address,
        sealed,
        policy.code,
        policy.permanent,
        eventId,
      );
      if (!isOwned()) throw new StaleDeliveryError();
      return result;
    });
    // Только после durable failure commit. Raw/ciphertext/key/headers в log contract отсутствуют.
    if (saved.status !== 'resolved')
      logEvent(
        saved.status === 'quarantine' ? 'consumer.partition_blocked' : 'consumer.partition_retry',
        {
          module: 'worker',
          destination: 'inventory.putaway',
          quarantineId: saved.id,
          partition: address.partition,
          eventId: eventId ?? undefined,
          errorCode: saved.errorCode,
          attempt: saved.attempts,
        },
      );
  }
  /** Resolution входит в effect/marker/cursor commit, а не в отдельный best-effort callback. */
  async resolve(context: TransactionContext, address: KafkaAddress): Promise<void> {
    await this.repository.resolve(context, address);
  }
  /** Safe inspect требует DB admin даже при прямом вызове без CLI. */
  async inspect(id: string) {
    if (!isUuid(id)) throw new Error('Invalid quarantine id');
    return this.transactions.run(async (tx) => {
      await this.repository.authorize(tx);
      return this.repository.inspect(tx, id);
    });
  }
  private validate(command: KafkaRecoveryCommand): void {
    if (
      !isUuid(command.id) ||
      !isUuid(command.operatorId) ||
      !isUuid(command.correlationId) ||
      !/^[a-z][a-z0-9._-]{0,95}$/.test(command.reasonCode)
    )
      throw new Error('Invalid Kafka recovery command');
  }
  private async recordAudit(
    context: TransactionContext,
    command: KafkaRecoveryCommand,
    action: string,
  ): Promise<string> {
    return this.audit.write(context, {
      actorType: 'user',
      actorId: command.operatorId,
      correlationId: command.correlationId,
      reasonCode: command.reasonCode,
      action,
      entityType: 'kafka-quarantine',
      entityId: command.id,
    });
  }
  /** Authorization, partition lock, budget reset и audit коммитятся вместе. Никакого seek/offset admin API. */
  async retry(command: KafkaRecoveryCommand) {
    this.validate(command);
    return this.transactions.run(async (tx) => {
      await this.repository.authorize(tx);
      const row = await this.repository.inspect(tx, command.id);
      await this.repository.retry(tx, row);
      const auditId = await this.recordAudit(tx, command, 'kafka.quarantine-retry-scheduled');
      return {
        id: row.id,
        eventId: row.event_id,
        topic: row.topic,
        partition: row.partition,
        offset: row.offset,
        auditId,
        status: 'retry',
      };
    });
  }
  /** Export authorization audit коммитится до filesystem write; plaintext возвращается только trusted CLI, не logger. */
  async exportRaw(command: KafkaRecoveryCommand): Promise<Buffer> {
    this.validate(command);
    if (!this.crypto) throw new Error('Kafka recovery key required');
    const source = await this.transactions.run(async (tx) => {
      await this.repository.authorize(tx);
      const row = await this.repository.inspect(tx, command.id);
      const sealed = await this.repository.sealed(tx, command.id);
      await this.recordAudit(tx, command, 'kafka.quarantine-export-authorized');
      return { row, sealed };
    });
    return this.crypto.open(
      { topic: source.row.topic, partition: source.row.partition, offset: source.row.offset },
      source.sealed,
    );
  }
  /** Cleanup разрешён только явно; unresolved остаются независимо от возраста. */
  async cleanup(command: KafkaRecoveryCommand) {
    this.validate(command);
    return this.transactions.run(async (tx) => {
      await this.repository.authorize(tx);
      const deleted = await this.repository.cleanup(tx);
      const auditId = await this.recordAudit(tx, command, 'kafka.quarantine-cleaned');
      return { deleted, auditId };
    });
  }
}
