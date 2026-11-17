/** @file Consumer graph использует application capability ApplicationConsumerModule; polling local worker не запускается. */
import {
  KafkaRecoveryService,
  QUARANTINE_CRYPTO,
  loadQuarantineCrypto,
} from './services/kafka-recovery.service';
import { QuarantineRepository } from './repositories/quarantine.repository';
import { AuditModule } from '../../modules/audit/audit.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ApplicationConsumerModule } from '../worker/application-consumer.module';
import { KafkaMessageService } from './services/kafka-message.service';
/** HTTP/auth/controllers отсутствуют; inventory handler общий с local worker. */
@Module({
  imports: [DatabaseModule, ApplicationConsumerModule, AuditModule],
  providers: [
    KafkaMessageService,
    QuarantineRepository,
    KafkaRecoveryService,
    { provide: QUARANTINE_CRYPTO, useFactory: loadQuarantineCrypto },
  ],
  exports: [KafkaMessageService, KafkaRecoveryService],
})
export class KafkaConsumerModule {}
