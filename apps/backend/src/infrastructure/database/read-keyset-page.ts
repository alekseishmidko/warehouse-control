/** @file SQL keyset pagination: один SELECT со стабильным ключом, без OFFSET/COUNT и ORM объектов в ответе. */
import { sql, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../shared/transactions/transaction.port';
import { CommandError } from '../../shared/errors/command-error';
import {
  encodePageCursor,
  type PageRequest,
  type KeysetPage,
} from '../../shared/pagination/keyset-page';
import { transactionClient } from './postgres-transaction-runner';
/** Доверенная SQL-конфигурация repository; все имена/проекции задаёт код, значения — SQL parameters. */
export interface ReadPageSql {
  readonly from: SQL;
  readonly projection: SQL;
  readonly where: SQL;
  readonly id: SQL;
  readonly time?: SQL;
}
/**
 * Выполняет один SELECT в borrowed context после policy. Дополнительная строка определяет nextCursor.
 * @param query Только фиксированные SQL fragments владельца; пользователь не выбирает таблицы/сортировку.
 * @returns Явная projection без служебных ключей; timestamptz cursor сохраняет микросекунды.
 * @throws VALIDATION_FAILED при cursor другого вида ключа; SQL timeout/ошибка откатывает внешний run.
 */
export async function readKeysetPage<T>(
  context: TransactionContext,
  request: PageRequest,
  query: ReadPageSql,
): Promise<KeysetPage<T>> {
  const { position } = request;
  if (position && Boolean(query.time) !== (position.time !== undefined))
    throw new CommandError('VALIDATION_FAILED');
  // История идёт от нового к старому. У таблиц без времени используется UUID ASC, без выдуманной хронологии.
  let continuation = sql`true`;
  if (position) {
    // Сравнение идёт по полному tuple: одинаковое время не теряет соседние UUID.
    continuation = query.time
      ? sql`(${query.time},${query.id}) < (${position.time}::timestamptz,${position.id}::uuid)`
      : sql`${query.id} > ${position.id}::uuid`;
  }
  // Cursor хранит PostgreSQL microseconds; JS Date не участвует в SQL projection.
  const timeProjection = query.time
    ? sql`,to_char(${query.time} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "_pageTime"`
    : sql``;
  const ordering = query.time ? sql`${query.time} desc,${query.id} desc` : sql`${query.id} asc`;
  const rows = (
    await transactionClient(context).execute<Record<string, unknown>>(sql`
    select ${query.projection}, ${query.id} as "_pageId"
      ${timeProjection}
    from ${query.from} where ${query.where} and ${continuation}
    order by ${ordering}
    limit ${request.limit + 1}`)
  ).rows;
  const selected = rows.slice(0, request.limit);
  const last = selected.at(-1);
  const nextCursor =
    rows.length > request.limit && last
      ? encodePageCursor(request, {
          id: String(last._pageId),
          ...(query.time ? { time: String(last._pageTime) } : {}),
        })
      : null;
  // Удаляем только наши служебные поля; repository явно перечисляет каждый публичный столбец.
  const items = selected.map(({ _pageId, _pageTime, ...item }) => item as T);
  return { items, nextCursor };
}
