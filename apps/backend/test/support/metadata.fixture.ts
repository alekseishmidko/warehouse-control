/** @file Технический fixture metadata: уникальные значения без копирования бизнес-правил. */
import { randomUUID } from 'node:crypto';

/** Строит независимую запись; переопределение key допустимо для проверки изоляции разных БД. */
export function metadataFixture(overrides: Partial<{ key: string; value: string }> = {}) {
  return { key: `fixture-${randomUUID()}`, value: 'integration-fixture', ...overrides };
}
