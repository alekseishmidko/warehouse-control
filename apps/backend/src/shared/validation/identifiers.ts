/** @file Переиспользуемая UUID-проверка для внутренних DTO; не раскрывает значения при отказе. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Проверяет синтаксис UUID без привязки к версии/существованию записи. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
/** Отклоняет неверный UUID безопасной ошибкой с доверенным названием поля. */
export function requireUuid(value: unknown, field: string): asserts value is string {
  if (!isUuid(value)) throw new Error(`Invalid ${field}`);
}
