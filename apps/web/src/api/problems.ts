/** @file Понятные сообщения менеджеру; server detail и произвольные exception messages не выводятся. */
import { ApiError, UncertainResult } from './client';
const messages: Record<string, string> = {
  NETWORK_ERROR: 'Не получен ответ сервера. Проверьте соединение и обновите данные.',
  COMMAND_SAVE_FAILED:
    'Браузер не позволил сохранить запрос. Команда не отправлена. Проверьте доступность хранилища вкладки.',
  UNAUTHORIZED: 'Сессия завершена. Войдите снова.',
  FORBIDDEN: 'Для этого действия нет права на выбранном складе.',
  CSRF_REJECTED: 'Не удалось подтвердить сессию. Войдите снова.',
  VALIDATION_FAILED: 'Проверьте поля и допустимое количество.',
  INVALID_RECEIPT: 'Проверьте состав приёмки.',
  INSUFFICIENT_STOCK: 'Недостаточно свободного товара в исходной ячейке.',
  ORDER_STATE_CONFLICT: 'Состояние документа изменилось. Обновите данные.',
  IDEMPOTENCY_CONFLICT: 'Этот ключ уже связан с другим запросом. Исходная команда сохранена.',
  PUTAWAY_ALREADY_COMPLETED: 'Задание уже выполнено. Обновите список.',
  RECEIPT_ALREADY_POSTED: 'Приёмка уже проведена. Обновите документ.',
  TOO_MANY_REQUESTS: 'Слишком много попыток входа. Повторите позже.',
  STOCK_LIMIT_EXCEEDED: 'Количество превысит допустимый остаток.',
};
/** Correlation ID помогает поддержке; значение валидируется middleware, не содержит payload. */
export function problemMessage(error: unknown): string {
  if (error instanceof UncertainResult)
    return 'Ответ не получен. Операция могла выполниться. Проверьте её результат с сохранённым ключом.';
  if (error instanceof ApiError)
    return (
      (messages[error.code] ??
        'Операция отклонена. Обновите данные и проверьте состояние документа.') +
      (error.correlationId ? ` Код обращения: ${error.correlationId}` : '')
    );
  return 'Не удалось выполнить действие. Проверьте соединение и повторите.';
}
