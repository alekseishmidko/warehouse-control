/** @file Единый безопасный application/problem+json mapper; исходные driver/validation сообщения наружу не выдаются. */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CommandError } from '../../shared/errors/command-error';
import { correlationIdOf } from './request-context';
/** Статические публичные коды/статусы — allowlist, arbitrary error.message не сериализуется. */
export const PROBLEMS = {
  RECEIPT_NOT_FOUND: [404, 'Receipt not found'], RECEIPT_ALREADY_POSTED: [409, 'Receipt already posted'],
  INVALID_RECEIPT: [422, 'Invalid receipt lines'], PRODUCT_NOT_FOUND: [422, 'Product not found'],
  LOCATION_NOT_FOUND: [422, 'Location does not belong to warehouse'], INVALID_RECEIVING_LOCATION: [422, 'Receiving location required'],
  STOCK_LIMIT_EXCEEDED: [422, 'Stock quantity limit exceeded'],
  VALIDATION_FAILED: [400, 'Invalid request'], INVALID_CORRELATION_ID: [400, 'Invalid correlation identifier'],
  IDEMPOTENCY_KEY_REQUIRED: [400, 'Idempotency key required'], INVALID_IDEMPOTENCY_KEY: [400, 'Invalid idempotency key'],
  DEV_ACTOR_UNAVAILABLE: [403, 'Isolated development actor unavailable'], IDEMPOTENCY_CONFLICT: [409, 'Idempotency key conflicts with request'],
  REQUEST_TOO_LARGE: [413, 'Request too large'], NOT_FOUND: [404, 'Resource not found'], UNAUTHORIZED: [401, 'Authentication required'],
  FORBIDDEN: [403, 'Access denied'], CONFLICT: [409, 'State conflict'], OPERATION_REJECTED: [422, 'Operation rejected'],
  SERVICE_UNAVAILABLE: [503, 'Service temporarily unavailable'], INTERNAL_ERROR: [500, 'Internal server error'],
} as const;
/**
 * Выбирает доверенный публичный code без разбора произвольного error.message.
 * CommandError/HttpException обрабатываются первыми; для wrapped SQL errors читается
 * только code через максимум шесть cause. Неизвестные ошибки становятся INTERNAL_ERROR.
 * Не вызывает retry и не меняет исход транзакции — SQL/callback уже откатил её владелец.
 */
function errorCode(error: unknown): keyof typeof PROBLEMS {
  if (error instanceof CommandError) return error.code;
  if (error instanceof HttpException) {
    const statuses: Partial<Record<number, keyof typeof PROBLEMS>> = { 400: 'VALIDATION_FAILED', 401: 'UNAUTHORIZED',
      403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'REQUEST_TOO_LARGE', 422: 'OPERATION_REJECTED', 503: 'SERVICE_UNAVAILABLE' };
    return statuses[error.getStatus()] ?? 'INTERNAL_ERROR';
  }
  let current = error;
  // Ограничение depth не даёт зациклиться на cyclic cause и не сериализует Error целиком.
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: string; cause?: unknown; status?: number; statusCode?: number };
    if (candidate.code === '23505') return 'CONFLICT';
    if (['23503', '23514'].includes(candidate.code ?? '')) return 'OPERATION_REJECTED';
    // 503 сообщает о временном отказе, но не доказывает rollback потерянного commit:
    // client повторяет исходный idempotency key, сервер не запускает скрытый retry.
    if (['40001', '40P01', '57P01', '08006', 'ECONNREFUSED'].includes(candidate.code ?? '')) return 'SERVICE_UNAVAILABLE';
    // Ошибки body parser могут не наследовать Nest HttpException.
    if (candidate.status === 400 || candidate.statusCode === 400) return 'VALIDATION_FAILED';
    if (candidate.status === 413 || candidate.statusCode === 413) return 'REQUEST_TOO_LARGE';
    current = candidate.cause;
  }
  return 'INTERNAL_ERROR';
}
/** Request instance содержит только pathname: query string может содержать чувствительные значения. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  /**
   * Отправляет application/problem+json со статическим detail и correlationId текущего request.
   * Не отправляет второй ответ, если headers уже ушли или клиент оборвал соединение.
   * Query исключается из instance; stack/SQL/raw payload/exception detail не отражаются.
   */
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    // Response после client timeout может быть уже закрыт, хотя DB transaction закончилась.
    if (response.headersSent || response.destroyed) return;
    const code = errorCode(error); const [status, title] = PROBLEMS[code];
    const correlationId = correlationIdOf(request);
    response.status(status).setHeader('Content-Type', 'application/problem+json');
    response.setHeader('X-Correlation-Id', correlationId);
    response.json({ type: `urn:warehouse:problem:${code.toLowerCase().replaceAll('_', '-')}`, title, status,
      detail: title, instance: request.path ?? '/', code, correlationId });
  }
}
