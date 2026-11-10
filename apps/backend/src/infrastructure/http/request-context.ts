/** @file HTTP request-local context без process.env/global actor; WeakMap не переносит данные между запросами. */
import { context, trace, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { remoteTrace } from '../logging/telemetry';
import { logScope, logEvent } from '../logging/runtime-logger';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { CommandError } from '../../shared/errors/command-error';
import { isUuid } from '../../shared/validation/identifiers';
import type { CommandScope } from '../../shared/operations/dto/command-scope.dto';
// Объект Request — ключ жизненного цикла: после его освобождения WeakMap не удерживает
// context. Общего изменяемого currentActor/currentCorrelationId между запросами нет.
const contexts = new WeakMap<Request, { correlationId: string; command?: CommandScope }>();
/**
 * Устанавливает request-local correlation до body parser, guards и routes.
 * Валидный UUID приводится lowercase; отсутствующий/невалидный заменяется новым UUID.
 * В невалидном случае вызывает next(CommandError), чтобы единый filter вернул 400;
 * response header уже содержит безопасный ID, а неверное клиентское значение не отражается.
 * Не проверяет identity, не пишет БД и не начинает transaction.
 */
export function correlationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.headers['x-correlation-id'];
  const valid = typeof incoming === 'string' && isUuid(incoming);
  // Header может быть массивом/объединённой строкой при повторении: UUID validation
  // не выбирает произвольный элемент и не принимает неоднозначный context.
  const correlationId = valid ? incoming.toLowerCase() : randomUUID();
  contexts.set(request, { correlationId });
  response.setHeader('X-Correlation-Id', correlationId);
  const remote = remoteTrace(request.headers.traceparent);
  const parent = remote ? trace.setSpanContext(ROOT_CONTEXT, remote) : ROOT_CONTEXT;
  const span = trace
    .getTracer('warehouse')
    .startSpan('http.request', { kind: SpanKind.SERVER }, parent);
  const started = performance.now();
  const fields = {
    correlationId,
    module: 'http' as const,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
  };
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    const aborted = !response.writableFinished;
    span.setAttribute('http.response.status_code', response.statusCode);
    span.setStatus({
      code: aborted || response.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
    });
    context.with(trace.setSpan(parent, span), () =>
      logScope(fields, () =>
        logEvent(
          aborted
            ? 'http.aborted'
            : response.statusCode >= 500
              ? 'http.failed'
              : response.statusCode >= 400
                ? 'http.rejected'
                : 'http.completed',
          {
            httpStatus: response.statusCode,
            durationMs: performance.now() - started,
            ...(response.statusCode >= 500
              ? { errorCode: 'HTTP_FAILED' }
              : response.statusCode >= 400
                ? { errorCode: 'HTTP_REJECTED' }
                : {}),
          },
        ),
      ),
    );
    span.end();
  };
  response.once('finish', finish);
  response.once('close', finish);
  context.with(trace.setSpan(parent, span), () =>
    logScope(fields, () => {
      if (incoming !== undefined && !valid) next(new CommandError('INVALID_CORRELATION_ID'));
      else next();
    }),
  );
}
/** Возвращает ID текущего request; fallback генерирует новый UUID, но не сохраняет его при отсутствии middleware. */
export function correlationIdOf(request: Request): string {
  return contexts.get(request)?.correlationId ?? randomUUID();
}
/**
 * Guard задаёт доверенный scope только этому Request после проверки actor/operation/key.
 * Замена записи сохраняет correlationId scope; Object.freeze запрещает изменение его scalar fields.
 * Не следует вызывать из controller с клиентским body вместо guard validation.
 */
export function setCommandScope(request: Request, scope: CommandScope): void {
  contexts.set(request, { correlationId: scope.correlationId, command: Object.freeze(scope) });
}
/**
 * Возвращает scope после guard для parameter decorator.
 * @throws Error если HttpCommand/guard wiring не создал context; anonymous fallback запрещён.
 */
export function commandScopeOf(request: Request): CommandScope {
  const scope = contexts.get(request)?.command;
  if (!scope) throw new Error('Command scope is missing');
  return scope;
}
