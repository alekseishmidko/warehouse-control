/** @file Внутренние контракты административного CLI. UUID оператора сообщает локальный вызывающий;
 * это не проверка личности через HTTP. Проверки значений находятся в recovery-options.ts. */
/** Адрес одной доставки: eventId — UUID сохранённого факта, consumer — имя зарегистрированного обработчика.
 * Оба поля недоверенные до validateAddress; один факт может иметь несколько получателей. */
export interface DeliveryAddress {
  readonly eventId: string;
  readonly consumer: string;
}
/** Команда восстановления после устранения причины сбоя. operatorId обязателен для аудита,
 * reasonCode — технический код до 96 символов без персональных данных. correlationId создаёт
 * CLI для данного вмешательства; он не заменяет correlationId исходного события. */
export interface RetryDeliveryDto extends DeliveryAddress {
  readonly operatorId: string;
  readonly reasonCode: string;
  readonly correlationId: string;
}
/** Пороги локального сигнала: deadLimit/backlogLimit — количества доставок, maxAgeSeconds — секунды.
 * Все значения — целые 1..1000000; достижение любого порога означает alert, а не запуск retry. */
export interface BacklogThresholds {
  readonly deadLimit: number;
  readonly backlogLimit: number;
  readonly maxAgeSeconds: number;
}
/** Закрытый список безопасных отказов CLI/сервиса. Значения допустимо выводить;
 * произвольные сообщения SQL/драйвера сюда не передаются. */
export type RecoveryErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'LOCAL_ACCESS_REQUIRED'
  | 'ADMIN_ROLE_REQUIRED'
  | 'DELIVERY_NOT_FOUND'
  | 'DELIVERY_BUSY'
  | 'LEASE_ACTIVE'
  | 'NOT_DEAD'
  | 'PREDECESSOR_REQUIRED'
  | 'ALREADY_PROCESSED'
  | 'ATTEMPT_LIMIT_REACHED';
/** Отказ административной операции: внутри callback приводит к откату всей транзакции.
 * Класс не содержит HTTP-ответа, учётных данных или исходного исключения драйвера. */
export class RecoveryError extends Error {
  /** Принимает только код из RecoveryErrorCode; CLI выводит его без стека и исходной причины. */
  constructor(readonly code: RecoveryErrorCode) {
    super(code);
  }
}
