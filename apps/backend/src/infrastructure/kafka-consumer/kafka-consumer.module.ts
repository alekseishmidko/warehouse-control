/** @file Consumer graph использует application capability ApplicationConsumerModule; polling local worker не запускается. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ApplicationConsumerModule } from '../worker/application-consumer.module';
import { KafkaMessageService } from './services/kafka-message.service';
/** HTTP/auth/controllers отсутствуют; inventory handler общий с local worker. */
@Module({
  imports: [DatabaseModule, ApplicationConsumerModule],
  providers: [KafkaMessageService],
  exports: [KafkaMessageService],
})
export class KafkaConsumerModule {}
