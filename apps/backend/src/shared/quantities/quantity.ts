/** @file Общий int4-контракт количества: SQL, внутренние DTO, аудит и draft event schema. */
/** Максимум PostgreSQL integer, точно представимый JavaScript number. */
export const MAX_STOCK_QUANTITY = 2147483647;
/** Допускает остаток 0..MAX; положительные movements проверяются отдельно. */
export function isStockQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_STOCK_QUANTITY
  );
}
/** Начисление должно быть целым 1..MAX, без неявного преобразования строк. */
export function requirePositiveQuantity(value: unknown): asserts value is number {
  if (!isStockQuantity(value) || value === 0) throw new Error('Invalid quantity');
}
