/** @file OpenAPI реальных controllers, включая receiving; Problem/header components описывают общие правила команд. */
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PROBLEMS } from './problem.filter';
/**
 * Создаёт OpenAPI текущих production controllers и общих boundary schemas.
 * @param app Созданный Nest graph после configureHttp; lifecycle init/listen не требуются.
 * @returns Новый in-memory document; файловую запись/сравнение выполняет CLI.
 * Не подключается к БД и не добавляет маршруты для запланированных business controllers.
 */
export function createOpenApiDocument(app: INestApplication) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Warehouse Controller API')
      .addCookieAuth(
        '__Host-wms_session',
        {
          type: 'apiKey',
          in: 'cookie',
          description: 'HTTPS session cookie; локальный HTTP использует wms_session.',
        },
        'session',
      )
      .setVersion('1.0.0')
      .setDescription(
        'Технические endpoints и приёмка draft → posted. Session auth, CSRF и роли конкретного склада; dev actor отсутствует.',
      )
      .build(),
  );
  document.components ??= {};
  document.components.schemas ??= {};
  // Component описывает header contract, но сам по себе не создаёт business path.
  document.components.parameters = {
    ...document.components.parameters,
    IdempotencyKey: {
      in: 'header',
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description:
        'Scope actor/operation/key: изменённый нормализованный запрос с тем же ключом → 409. Повтор возвращает сохранённый status/body/Location.',
    },
  };
  document.components.schemas.Problem = {
    type: 'object',
    required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'correlationId'],
    properties: {
      type: { type: 'string', format: 'uri' },
      title: { type: 'string' },
      status: { type: 'integer' },
      detail: { type: 'string' },
      instance: { type: 'string' },
      code: { type: 'string', enum: Object.keys(PROBLEMS) },
      correlationId: { type: 'string', format: 'uuid' },
    },
  };
  // Обогащаем только уже обнаруженные операции, не переписывая их response descriptions.
  for (const path of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = path[method];
      if (!operation) continue;
      operation.parameters ??= [];
      const publicRoute = ['/', '/health', '/api/v1/auth/login'].includes(
        Object.entries(document.paths).find(([, value]) => value === path)?.[0] ?? '',
      );
      if (!publicRoute) operation.security ??= [{ session: [] }];
      if (method !== 'get') {
        if (!operation.parameters.some((p) => !('$ref' in p) && p.name === 'Origin'))
          operation.parameters.push({
            in: 'header',
            name: 'Origin',
            required: true,
            schema: { type: 'string' },
            description: 'Точное значение AUTH_ORIGIN.',
          });
        if (
          !publicRoute &&
          !operation.parameters.some((p) => !('$ref' in p) && p.name === 'X-CSRF-Token')
        )
          operation.parameters.push({
            in: 'header',
            name: 'X-CSRF-Token',
            required: true,
            schema: { type: 'string' },
            description: 'CSRF текущей сессии из login/me.',
          });
      }
      operation.parameters.push({
        in: 'header',
        name: 'X-Correlation-Id',
        required: false,
        schema: { type: 'string', format: 'uuid' },
        description:
          'Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id.',
      });
      // ??= сохраняет явно задокументированный ответ конкретного controller.
      for (const status of ['400', '401', '403', '404', '500'])
        operation.responses[status] ??= {
          description: 'Безопасный problem response; stack/driver input не раскрываются.',
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
          },
        };
      for (const response of Object.values(operation.responses)) {
        // Ссылочный response не разворачиваем/не меняем: его контракт принадлежит component.
        if (!response || '$ref' in response) continue;
        response.headers = {
          ...response.headers,
          'X-Correlation-Id': {
            description: 'Идентификатор текущего HTTP запроса, включая replay.',
            schema: { type: 'string', format: 'uuid' },
          },
        };
      }
    }
  }
  return document;
}
