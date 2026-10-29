/** @file Production durable consumer inventory.putaway: validated ReceivingPosted → public inventory API, не повтор stock. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
import { InventoryService } from '../../../modules/inventory/services/inventory.service';
import { PutawayInputError } from '../../../modules/inventory/services/putaway.service';
import { PUTAWAY_DESTINATION } from '../../outbox/outbox-destinations';
import type { LocalEventHandler } from '../dto/delivery.dto';
import { PermanentDeliveryError } from '../delivery-policy';

/** Стабильный технический субъект consumer, синтетический UUID, не пользователь/credential и не actor из payload. */
export const PUTAWAY_SYSTEM_ACTOR_ID = 'fdbeb4bc-9e7b-4abb-a7b9-0fcd698cb7d1';
/** Stable consumerName = destination; registry подписан на весь receipt stream, фильтрации deliveries по type нет. */
@Injectable()
export class ReceivingPostedHandler implements LocalEventHandler {
  readonly destination = PUTAWAY_DESTINATION;
  /** Внедряет только публичный inventory service; repositories и transaction owner остаются у владельцев. */
  constructor(private readonly inventory: InventoryService) {}
  /**
   * Worker уже проверил schema/routing и держит locks; handler получает тот же context.
   * Для известного неинтересного type — no-op; worker всё равно пишет marker/cursor.
   * Сегодня registry знает только ReceivingPosted v1: неизвестные type/version до этой ветки не допускаются.
   * @throws PermanentDeliveryError при semantic конфликте; остальные SQL/contract errors классифицирует worker.
   */
  async handle(context: TransactionContext, event: KnownEvent): Promise<void> {
    if (event.type !== 'receiving.receipt-posted') return;
    try {
      await this.inventory.createPutawayTasks(context, {
        event,
        actorType: 'system',
        actorId: PUTAWAY_SYSTEM_ACTOR_ID,
        correlationId: event.correlationId,
        reasonCode: 'receipt-posted',
      });
    } catch (error) {
      if (error instanceof PutawayInputError) throw new PermanentDeliveryError('HANDLER_REJECTED');
      throw error;
    }
  }
}
