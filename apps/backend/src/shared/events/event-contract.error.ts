/** @file Безопасные коды отказа контракта; payload, credentials и Ajv input не включаются в диагностику. */

/**
 * Стабильные коды ошибок контракта для классификации worker WMS-109:
 * - INVALID_JSON — сообщение нельзя разобрать или input нельзя сериализовать;
 * - INVALID_EVENT — известный контракт нарушен либо заголовок некорректен;
 * - UNSUPPORTED_EVENT — корректная пара type/version отсутствует в registry;
 * - MESSAGE_TOO_LARGE — превышен лимит JSON UTF-8 bytes.
 *
 * Повтор без изменения данных или обновления поддерживаемых версий не поможет.
 * Worker сохраняет permanent code в dead delivery; отдельной quarantine table нет.
 */
export type EventContractErrorCode =
  'INVALID_JSON' | 'INVALID_EVENT' | 'UNSUPPORTED_EVENT' | 'MESSAGE_TOO_LARGE';

/** Ошибка до бизнес-эффекта. Не означает успешную обработку или существование durable quarantine. */
export class EventContractError extends Error {
  /** Создаёт безопасную ошибку без исходного payload, значений полей и внутренних ошибок Ajv. */
  constructor(readonly code: EventContractErrorCode) {
    super(`Event contract rejected: ${code}`);
    // Отдельное имя позволяет отличать отказ контракта от инфраструктурного сбоя.
    this.name = 'EventContractError';
  }
}
