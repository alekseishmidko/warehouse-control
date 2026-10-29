/** @file Общая настройка production/test/OpenAPI приложения до init; не открывает listener и не касается БД. */
import type { Request, Response, NextFunction } from 'express';
import { INestApplication, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { correlationMiddleware } from './request-context';
/**
 * Настраивает Express-backed Nest app до init одинаково для API, harness и offline OpenAPI.
 * Существующие технические GET остаются без prefix; будущие бизнес-routes — /api/v1.
 * Не открывает listener/БД. Вызывать один раз: middleware должен стоять перед body parser.
 */
export function configureHttp(app: INestApplication): void {
  // Session/profile/ошибки и business responses не кешируются shared proxy/browser cache.
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(correlationMiddleware);
  // Даже parser errors получат correlationId, потому что middleware зарегистрирован первым.
  (app as NestExpressApplication).useBodyParser('json', { limit: 256 * 1024 });
  // Исключение ограничено GET: оно не делает произвольные будущие методы root controller публичными по URL.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
    ],
  });
}
