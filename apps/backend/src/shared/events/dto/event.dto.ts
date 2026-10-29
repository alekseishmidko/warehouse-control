/** @file Внутренние DTO границ событий: payload берётся из generated contract, не из ORM или backend-моделей. */
import type { ReceivingPostedV1, PutawayCompletedV1 } from '../generated/event-types';

/**
 * Union всех поддерживаемых событий; включает ReceivingPosted и PutawayCompleted.
 * При добавлении типа/версии расширяется вместе с registry для narrowing по type/version.
 * Сам TypeScript-тип не доказывает корректность внешнего JSON: обязательна runtime-проверка.
 */
export type KnownEvent = ReceivingPostedV1 | PutawayCompletedV1;

/**
 * Payload факта проведённой приёмки из исходной JSON Schema, без ручного повторения полей.
 * Предназначен для формирования события, а не для HTTP-команды создания документа.
 * Числовые диапазоны и предел строк обеспечивает EventContracts runtime.
 */
export type ReceivingPostedPayload = ReceivingPostedV1['payload'];

/** Проверенная копия JSON и её сериализация для INSERT outbox в общей транзакции. */
export interface PreparedEvent {
  /** Независимый snapshot для чтения полей; readonly не делает вложенные объекты неизменяемыми runtime. */
  readonly event: KnownEvent;
  /** Уже проверенный JSON для будущего INSERT; нельзя собирать его заново из изменённого event/input. */
  readonly message: string;
}
