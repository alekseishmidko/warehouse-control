/** @file Общая нормализация SKU/code и названий ресурсов catalog/warehouses. */
/** Нормализует ограниченный технический SKU/code в uppercase; не принимает произвольный текст. */
export function normalizeCode(value: string, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(normalized)) throw new Error(`Invalid ${field}`);
  return normalized;
}
/** Проверяет непустое название до 160 символов, возвращает trimmed значение. */
export function normalizeName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid name');
  return value.trim();
}
