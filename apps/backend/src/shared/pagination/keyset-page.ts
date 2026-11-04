/** @file Независимый от SQL cursor protocol: ограниченная страница и привязанный к фильтрам ключ продолжения. */
import { createHash } from 'node:crypto';
import { CommandError } from '../errors/command-error';
import { isUuid } from '../validation/identifiers';
/** Единый канонический предел HTTP/service: 1..100 строк без экспоненты, знака и ведущих нулей. */
export const PAGE_LIMIT_PATTERN = /^(?:[1-9]|[1-9][0-9]|100)$/;
/** Размер первой страницы при отсутствии limit. */
export const DEFAULT_PAGE_LIMIT = '20';
/** Публичный JSON результат; total отсутствует, чтобы не выполнять неограниченный COUNT. */
export interface KeysetPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}
/** Время сохраняет все шесть дробных знаков PostgreSQL; Date для cursor не используется. */
export interface PagePosition {
  readonly id: string;
  readonly time?: string;
}
/** Нормализованные значения; scope включает маршрут, склад и каждый фильтр, но не размер страницы. */
export interface PageRequest {
  readonly limit: number;
  readonly scope: string;
  readonly position?: PagePosition;
}
/** Создаёт bounded request из уже валидированного DTO; malformed/cross-filter cursor отклоняется безопасно. */
export function preparePageRequest(
  resource: string,
  filters: Record<string, string>,
  limit = DEFAULT_PAGE_LIMIT,
  cursor?: string,
): PageRequest {
  const scope = createHash('sha256')
    .update(JSON.stringify([resource, Object.entries(filters).sort()]))
    .digest('hex');
  let position: PagePosition | undefined;
  if (cursor !== undefined) {
    try {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        !value ||
        value.v !== 1 ||
        value.scope !== scope ||
        !isUuid(value.id) ||
        Object.keys(value).some((k) => !['v', 'scope', 'id', 'time'].includes(k)) ||
        (value.time !== undefined &&
          (typeof value.time !== 'string' ||
            !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.time) ||
            // PostgreSQL не принимает год 0000; JS Date принимает. Отказ должен быть 400 до SQL.
            value.time.startsWith('0000-') ||
            !Number.isFinite(Date.parse(value.time)) ||
            new Date(value.time).toISOString() !== value.time.slice(0, 23) + 'Z'))
      )
        throw new Error();
      position = {
        id: value.id.toLowerCase(),
        ...(value.time === undefined ? {} : { time: value.time }),
      };
    } catch {
      throw new CommandError('VALIDATION_FAILED');
    }
  }
  if (!PAGE_LIMIT_PATTERN.test(limit)) throw new CommandError('VALIDATION_FAILED');
  return { limit: Number(limit), scope, position };
}
/** Сериализует только последний выданный ключ. Это навигация, не capability авторизации и не подпись данных. */
export function encodePageCursor(request: PageRequest, position: PagePosition): string {
  return Buffer.from(JSON.stringify({ v: 1, scope: request.scope, ...position })).toString(
    'base64url',
  );
}
