/** @file Outbox composition: producer и local recovery services, private SQL providers; без HTTP/worker startup. */
import { Module } from '@nestjs/common';
import { OutboxRepository } from './repositories/outbox.repository';
import { OutboxService } from './services/outbox.service';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../../modules/audit/audit.module';
import { RecoveryRepository } from './repositories/recovery.repository';
import { OutboxRecoveryService } from './services/outbox-recovery.service';

/** Использует общий DatabaseModule/AuditModule; repositories получают client только из обязательного context. */
@Module({ imports: [DatabaseModule, AuditModule], providers: [OutboxService, OutboxRepository, RecoveryRepository, OutboxRecoveryService],
  exports: [OutboxService, OutboxRecoveryService] })
export class OutboxModule {}
