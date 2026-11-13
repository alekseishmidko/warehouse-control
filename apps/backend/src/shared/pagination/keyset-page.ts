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
  filters: Readonly<Record<string, string | undefined>>,
  limit = DEFAULT_PAGE_LIMIT,
  cursor?: string,
): PageRequest {
  // Только заданные фильтры входят в scope. Это сохраняет прежние cursors,
  // когда caller передаёт optional поля явно вместо набора одинаковых if-блоков.
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
  const scope = createHash('sha256')
    .update(JSON.stringify([resource, entries.sort()]))
    .digest('hex');
  const position = cursor === undefined ? undefined : decodePagePosition(cursor, scope);
  if (!PAGE_LIMIT_PATTERN.test(limit)) throw new CommandError('VALIDATION_FAILED');
  return { limit: Number(limit), scope, position };
}
/** Недоверенный cursor проверяется до SQL. Ни его scope, ни UUID не заменяют warehouse ACL.
 * Все ошибки decoding/структуры сводятся к одному безопасному коду без входных данных.
 */
function decodePagePosition(cursor: string, scope: string): PagePosition {
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    if (
      !('v' in value) ||
      value.v !== 1 ||
      !('scope' in value) ||
      value.scope !== scope ||
      !('id' in value) ||
      !isUuid(value.id)
    )
      throw new Error();
    if (Object.keys(value).some((key) => !['v', 'scope', 'id', 'time'].includes(key)))
      throw new Error();
    const time = 'time' in value ? value.time : undefined;
    if (time !== undefined && !isCursorTimestamp(time)) throw new Error();
    return { id: value.id.toLowerCase(), ...(typeof time === 'string' ? { time } : {}) };
  } catch {
    throw new CommandError('VALIDATION_FAILED');
  }
}
/** Проверяет календарное время, сохраняя исходные шесть знаков для SQL cursor.
 * Date используется только для проверки: возвращать округлённый Date в position нельзя.
 * Год 0000 запрещён PostgreSQL, а нормализованная JS дата не должна скрывать 30 февраля.
 */
function isCursorTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value) &&
    !value.startsWith('0000-') &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value.slice(0, 23) + 'Z'
  );
}
/** Сериализует только последний выданный ключ. Это навигация, не capability авторизации и не подпись данных. */
export function encodePageCursor(request: PageRequest, position: PagePosition): string {
  return Buffer.from(JSON.stringify({ v: 1, scope: request.scope, ...position })).toString(
    'base64url',
  );
}
