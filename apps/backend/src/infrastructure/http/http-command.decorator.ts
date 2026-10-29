/** @file HTTP metadata: технические public routes и команды с постоянным server-side operation scope. */
import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { commandScopeOf } from './request-context';
/** Metadata key исключения из временного business guard, не клиентский header. */
export const TECHNICAL_ROUTE = 'warehouse:technical-route';
/** Metadata key постоянной operation: входит в уникальный idempotency scope. */
export const COMMAND_OPERATION = 'warehouse:command-operation';
/** Только / и /health отмечаются техническими; будущие бизнес-routes закрыты guard по умолчанию. */
export const TechnicalRoute = () => SetMetadata(TECHNICAL_ROUTE, true);
/**
 * Помечает метод командой и одновременно описывает required key/errors в OpenAPI.
 * @param operation Постоянный server-side идентификатор, не URL или значение из HTTP body.
 * @throws Error при неверном имени ещё на этапе применения decorator/module loading.
 * Сам decorator не выполняет authorization, validation или transaction: это guard/pipe/service.
 */
export function HttpCommand(operation: string) {
  if (!/^[a-z][a-z0-9.-]{0,95}$/.test(operation)) throw new Error('Invalid command operation');
  // Одна декларация связывает runtime guard и API description, чтобы key не стал
  // обязательным только в документации или только в реализации.
  return applyDecorators(
    SetMetadata(COMMAND_OPERATION, operation),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description:
        'Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409.',
    }),
    ...[400, 401, 403, 409, 413, 422, 500, 503].map((status) =>
      ApiResponse({
        status,
        description: 'Безопасный problem response; коды описаны в components.schemas.Problem.',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      }),
    ),
  );
}
/** Доверенный CommandScope устанавливает guard до validation/controller. */
export const CommandContext = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  commandScopeOf(context.switchToHttp().getRequest()),
);
