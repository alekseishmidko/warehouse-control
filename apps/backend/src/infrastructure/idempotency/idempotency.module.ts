/** @file Composition idempotency: экспортирует command service, SQL repository остаётся приватным. */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { HttpCommandsService } from './services/http-commands.service';
/** Предоставляет владеющий command transaction сервис без экспорта repository/ORM schema как публичного API. */
@Module({ imports: [DatabaseModule], providers: [IdempotencyRepository, HttpCommandsService], exports: [HttpCommandsService] })
export class IdempotencyModule {}
