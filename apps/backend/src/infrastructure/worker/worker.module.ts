/** @file Local worker graph: scheduler/config отдельно от общей application consumer capability. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ApplicationConsumerModule } from './application-consumer.module';
import { WORKER_CONFIG, loadWorkerConfig } from './worker.config';
import { WorkerService } from './services/worker.service';
import { WorkerLoop } from './services/worker-loop';
import { WorkerRepository } from './repositories/worker.repository';
/** Production handler подключён общим module; tests override тот же stable registration token. */
@Module({
  imports: [DatabaseModule, ApplicationConsumerModule],
  providers: [
    { provide: WORKER_CONFIG, useFactory: loadWorkerConfig },
    WorkerRepository,
    WorkerService,
    WorkerLoop,
  ],
  exports: [WorkerService, WorkerLoop, ApplicationConsumerModule],
})
export class WorkerModule {}
