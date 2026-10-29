/** @file Worker graph без HTTP/Receiving controllers; handlers подключаются явно в composition root WMS-110. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WORKER_CONFIG, loadWorkerConfig } from './worker.config';
import { HandlerRegistry, WORKER_HANDLERS } from './services/handler-registry';
import { WorkerService } from './services/worker.service';
import { WorkerLoop } from './services/worker-loop';
import { WorkerRepository } from './repositories/worker.repository';
import { InventoryModule } from '../../modules/inventory/inventory.module';
import { ReceivingPostedHandler } from './services/receiving-posted.handler';
/** Production registry содержит настоящий handler; tests могут явно заменить список, не меняя API graph. */
@Module({
  imports: [DatabaseModule, InventoryModule],
  providers: [
    { provide: WORKER_CONFIG, useFactory: loadWorkerConfig },
    ReceivingPostedHandler,
    {
      provide: WORKER_HANDLERS,
      useFactory: (handler: ReceivingPostedHandler) => [handler],
      inject: [ReceivingPostedHandler],
    },
    HandlerRegistry,
    WorkerRepository,
    WorkerService,
    WorkerLoop,
  ],
  exports: [WorkerService, WorkerLoop],
})
export class WorkerModule {}
