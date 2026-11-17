/** @file Kafka record boundary: schema/routing validation, общий application consumer и одна PostgreSQL transaction. */
import { KafkaRecoveryService } from './kafka-recovery.service';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { KafkaMessage } from 'kafkajs';
import { sql } from 'drizzle-orm';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/transactions/transaction.port';
import { EventContractError } from '../../../shared/events/event-contract.error';
import { EventContracts } from '../../../shared/events/services/event-contracts';
import { kafkaRoute } from '../../../shared/events/kafka-route';
import { kafkaTopology } from '../../../shared/events/generated/kafka-topology';
import { ApplicationConsumerService } from '../../worker/services/application-consumer.service';
import { PUTAWAY_DESTINATION } from '../../outbox/outbox-destinations';
import { PermanentDeliveryError, StaleDeliveryError } from '../../worker/delivery-policy';
import { transactionClient } from '../../database/postgres-transaction-runner';
import { logScope, logEvent } from '../../logging/runtime-logger';
import { traced, linkProducer } from '../../logging/telemetry';
/** Вход — недоверенный broker record. isOwned локален: никакого network I/O внутри callback runner. */
@Injectable()
export class KafkaMessageService {
  private readonly contracts = new EventContracts();
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
    private readonly application: ApplicationConsumerService,
    @Optional() private readonly recovery?: KafkaRecoveryService,
  ) {}
  /** Возвращает applied/duplicate только ПОСЛЕ commit; offset принадлежит вызывающему adapter.
   * Revocation, schema/routing mismatch, gap и любая DB ошибка дают rollback и не разрешают ack. */
  async process(
    topic: string,
    partition: number,
    message: KafkaMessage,
    isOwned: () => boolean,
    timeoutMs: number,
  ): Promise<'applied' | 'duplicate'> {
    const address = { topic, partition, offset: message.offset };
    await this.recovery?.check(address);
    if (!message.value) throw new EventContractError('INVALID_EVENT');
    const event = this.contracts.parseForHandler(message.value.toString('utf8'));
    const route = kafkaRoute(event);
    const header = (key: string) => {
      const value = message.headers?.[key];
      return Buffer.isBuffer(value)
        ? value.toString('utf8')
        : typeof value === 'string'
          ? value
          : undefined;
    };
    if (
      topic !== route.topic ||
      partition !== route.partition ||
      message.key?.toString('utf8') !== route.key ||
      !kafkaTopology[event.aggregateType].consumers.some((name) => name === PUTAWAY_DESTINATION) ||
      header('content-type') !== 'application/json' ||
      header('x-event-type') !== event.type ||
      header('x-schema-version') !== String(event.schemaVersion)
    )
      throw new PermanentDeliveryError('IDENTITY_MISMATCH');
    return logScope(
      {
        module: 'worker',
        eventId: event.eventId,
        aggregateId: event.aggregateId,
        correlationId: event.correlationId,
        destination: PUTAWAY_DESTINATION,
      },
      () =>
        traced(
          'handler',
          async (span) => {
            linkProducer(event.traceparent, span);
            const result = await this.transactions.run(async (context) => {
              await transactionClient(context).execute(
                sql`select set_config('transaction_timeout',${String(timeoutMs)},true),set_config('statement_timeout',${String(timeoutMs)},true)`,
              );
              if (!isOwned()) throw new StaleDeliveryError();
              await this.recovery?.guard(context, address);
              const result = await this.application.apply(context, PUTAWAY_DESTINATION, event);
              // Revoke во время ожидания SQL/handler откатывает и business effect, и marker/cursor.
              // Неизвестный до этого момента revoke может совпасть с commit; redelivery всё равно deduplicated.
              if (!isOwned()) throw new StaleDeliveryError();
              await this.recovery?.resolve(context, address);
              // Resolution тоже await SQL: revoke во время него должен откатить весь callback.
              if (!isOwned()) throw new StaleDeliveryError();
              return result;
            });
            logEvent('delivery.completed', {
              module: 'worker',
              eventId: event.eventId,
              aggregateId: event.aggregateId,
              destination: PUTAWAY_DESTINATION,
            });
            return result;
          },
          true,
        ),
    );
  }
}
