/** @file Общая application capability обоих transport: handler registry и retained consumer state без polling/config worker. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { InventoryModule } from '../../modules/inventory/inventory.module';
import { HandlerRegistry, WORKER_HANDLERS } from './services/handler-registry';
import { ReceivingPostedHandler } from './services/receiving-posted.handler';
import { ApplicationConsumerService } from './services/application-consumer.service';
import { ConsumerRepository } from './repositories/consumer.repository';
/** Kafka consumer не создаёт local worker scheduler и не зависит от WORKER_* environment. */
@Module({
  imports: [DatabaseModule, InventoryModule],
  providers: [
    ReceivingPostedHandler,
    {
      provide: WORKER_HANDLERS,
      useFactory: (handler: ReceivingPostedHandler) => [handler],
      inject: [ReceivingPostedHandler],
    },
    HandlerRegistry,
    ConsumerRepository,
    ApplicationConsumerService,
  ],
  exports: [HandlerRegistry, ApplicationConsumerService],
})
export class ApplicationConsumerModule {}
