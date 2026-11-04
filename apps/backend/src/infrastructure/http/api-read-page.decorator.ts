/** @file Общая Swagger схема bounded page; регистрирует реальный JSON DTO, а не ORM модель. */
import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
/** Описывает реальный generic JSON page в OpenAPI, не возвращая ORM или generic object без полей. */
export function ApiReadPage(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          nextCursor: { type: 'string', nullable: true },
        },
      },
    }),
  );
}
