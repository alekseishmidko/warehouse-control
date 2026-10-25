/** @file Владелец claim/process/failure transactions; handler effect и durable ack имеют одну границу commit. */
import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_RUNNER, TransactionRunner } from '../../../shared/transactions/transaction.port';
import { EventContracts } from '../../../shared/events/services/event-contracts';
import { WORKER_CONFIG, WorkerConfig } from '../worker.config';
import type { DeliveryClaim } from '../dto/delivery.dto';
import { classifyDeliveryError, PermanentDeliveryError, retryDelayMs, StaleDeliveryError } from '../delivery-policy';
import { WorkerRepository } from '../repositories/worker.repository';
import { HandlerRegistry } from './handler-registry';

/** Отдельный worker process использует этот service; API его не импортирует и не запускает polling. */
@Injectable()
export class WorkerService {
  private readonly contracts = new EventContracts();
  /** DI config/registry можно безопасно заменить в tests без env; repositories наружу не экспортируются. */
  constructor(@Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
    private readonly repository: WorkerRepository, private readonly registry: HandlerRegistry,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {}

  /** Короткий run, только scheduling SQL. Пустой registry не подтверждает и не claim-ит deliveries. */
  async claim(): Promise<DeliveryClaim[]> {
    if (!this.registry.destinations().length) return [];
    return this.transactions.run(async context => {
      await this.repository.boundTransaction(context, this.config.transactionTimeoutMs);
      return this.repository.claim(context, this.registry.destinations(), this.config);
    });
  }

  /**
   * Обрабатывает claim целиком один раз; stale token никогда не даёт effect/ack чужого владельца.
   * @returns completed после commit, retry/dead после отдельного failure commit, stale без изменений.
   * @throws Error если даже failure не удалось сохранить (например DB outage); lease затем восстановит другой poll.
   * Внешнее I/O в handler запрещено; все его операции awaited в одном context с marker/cursors/ack.
   */
  async process(claim: DeliveryClaim): Promise<'completed' | 'retry' | 'dead' | 'stale'> {
    try {
      await this.transactions.run(async context => {
        await this.repository.boundTransaction(context, this.config.transactionTimeoutMs);
        const delivery = await this.repository.lock(context, claim);
        if (!delivery) throw new StaleDeliveryError();
        const event = this.contracts.parseForHandler(JSON.stringify(delivery.envelope));
        // Защищаем routing identity дополнительно к SQL CHECK, до handler/marker.
        if (event.eventId.toLowerCase() !== claim.eventId || event.aggregateId.toLowerCase() !== claim.aggregateId
          || event.aggregateType !== claim.aggregateType || event.aggregateVersion !== claim.version) throw new PermanentDeliveryError('IDENTITY_MISMATCH');
        const handler = this.registry.get(claim.destination);
        if (!handler) throw new PermanentDeliveryError('HANDLER_MISSING');
        if (!await this.repository.prepareConsumer(context, claim)) {
          await handler.handle(context, event);
          await this.repository.markProcessed(context, claim);
        }
        // Lease мог истечь во время handler, но обе строки всё ещё locked:
        // reclaim SKIP LOCKED не сменит token до commit, повторной проверки wall clock не нужно.
        await this.repository.complete(context, claim);
      });
      return 'completed';
    } catch (error) {
      if (error instanceof StaleDeliveryError) return 'stale';
      const classification = classifyDeliveryError(error);
      // Callback уже rollback-нут. При потере commit ack эта проверка увидит completed
      // и не перепишет результат; при reclaim новым worker старый token тоже будет отклонён.
      return this.transactions.run(async context => {
        await this.repository.boundTransaction(context, this.config.transactionTimeoutMs);
        const delivery = await this.repository.lock(context, claim);
        if (!delivery) return 'stale';
        const dead = classification.permanent || delivery.attempts >= this.config.maxAttempts;
        await this.repository.fail(context, claim, dead, classification.code, retryDelayMs(delivery.attempts, this.config));
        return dead ? 'dead' : 'retry';
      });
    }
  }
}
