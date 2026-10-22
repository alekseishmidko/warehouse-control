/** @file Глобальные guard/filter/validation providers; prefix/correlation middleware настраиваются общим bootstrap helper. */
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { CommandError } from '../../shared/errors/command-error';
import { DatabaseModule } from '../database/database.module';
import { DevActorGuard } from './dev-actor.guard';
import { ProblemFilter } from './problem.filter';
/** Общие boundaries для всех controllers; не регистрирует бизнес-маршрутов и не создаёт transaction. */
@Module({ imports: [DatabaseModule], providers: [
  { provide: APP_GUARD, useClass: DevActorGuard }, { provide: APP_FILTER, useClass: ProblemFilter },
  // transform создаёт DTO instance, но не включает implicit number/string conversion.
  // Неизвестные поля отклоняются; exceptionFactory не возвращает значения/имена из input.
  { provide: APP_PIPE, useFactory: () => new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true,
    forbidUnknownValues: true, transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false }, exceptionFactory: () => new CommandError('VALIDATION_FAILED') }) },
] })
export class HttpModule {}
