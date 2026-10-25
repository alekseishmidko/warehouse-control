/** @file Worker graph без HTTP/Receiving controllers; handlers подключаются явно в composition root WMS-110. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WORKER_CONFIG, loadWorkerConfig } from './worker.config';
import { HandlerRegistry, WORKER_HANDLERS } from './services/handler-registry';
import { WorkerService } from './services/worker.service';
import { WorkerLoop } from './services/worker-loop';
import { WorkerRepository } from './repositories/worker.repository';
/** Без зарегистрированного бизнес-handler нет claim/ack; worker остаётся доступным для инфраструктурной проверки. */
@Module({ imports: [DatabaseModule], providers: [{ provide: WORKER_CONFIG, useFactory: loadWorkerConfig },
  { provide: WORKER_HANDLERS, useValue: [] }, HandlerRegistry, WorkerRepository, WorkerService, WorkerLoop],
  exports: [WorkerService, WorkerLoop] })
export class WorkerModule {}
