/** @file Transport-independent application обработка: один handler/effect/marker/cursor в borrowed DB transaction. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
import { HandlerRegistry } from './handler-registry';
import { ConsumerRepository } from '../repositories/consumer.repository';
import { PermanentDeliveryError } from '../delivery-policy';
/** Публичный service capability worker: Kafka не импортирует private repository и не копирует складские правила. */
@Injectable()
export class ApplicationConsumerService {
  constructor(
    private readonly registry: HandlerRegistry,
    private readonly repository: ConsumerRepository,
  ) {}
  /** Вызывающий владеет transaction. Duplicate возвращается только после проверки cursor и исходного envelope.
   * Ошибки handler/marker/cursor передаются владельцу run; здесь нет commit, retries и внешнего I/O. */
  async apply(
    context: TransactionContext,
    consumer: string,
    event: KnownEvent,
  ): Promise<'applied' | 'duplicate'> {
    const handler = this.registry.get(consumer);
    if (!handler) throw new PermanentDeliveryError('HANDLER_MISSING');
    await this.repository.assertRetained(context, event);
    if (await this.repository.prepare(context, consumer, event)) return 'duplicate';
    await handler.handle(context, event);
    await this.repository.complete(context, consumer, event);
    return 'applied';
  }
}
