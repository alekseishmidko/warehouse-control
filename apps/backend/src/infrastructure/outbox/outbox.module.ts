/** @file Nest composition outbox: публичный OutboxService и внутренний SQL repository, без worker startup. */
import { Module } from '@nestjs/common';
import { OutboxRepository } from './repositories/outbox.repository';
import { OutboxService } from './services/outbox.service';

/** Не требует нового DatabaseService: SQL получает client только через обязательный TransactionContext. */
@Module({ providers: [OutboxService, OutboxRepository], exports: [OutboxService] })
export class OutboxModule {}
