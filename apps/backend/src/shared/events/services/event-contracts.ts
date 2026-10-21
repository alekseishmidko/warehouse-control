/** @file Общие producer/handler границы JSON validation; никаких DB writes, handlers или transport I/O. */
import { EVENT_REGISTRY, MAX_EVENT_BYTES } from '../event-registry';
import { EventContractError } from '../event-contract.error';
import type { KnownEvent, PreparedEvent } from '../dto/event.dto';

/**
 * Единая проверка контракта на стороне producer и получателя.
 *
 * Не запускает handler, не пишет outbox, не открывает транзакций и не проверяет права.
 * Вызывающий сценарий отвечает за SQL/commit/rollback и бизнес-инварианты документа.
 * Неизвестные optional fields сохраняются; неподдерживаемые type/version отклоняются.
 */
export class EventContracts {
  /**
   * Подготавливает независимый JSON snapshot для записи через OutboxService.
   *
   * @param input Данные события из producer; доверять их TypeScript-типу недостаточно.
   * @returns Проверенный event и именно та строка message, которую проверил validator.
   * @throws EventContractError при ошибке сериализации, размера или контракта.
   *
   * Вызывать до INSERT и сохранять message в общей транзакции бизнес-сценария.
   * Лимит проверяется после сериализации и не ограничивает память уже созданного input.
   */
  prepareForOutbox(input: unknown): PreparedEvent {
    let message: string;
    try {
      // Проверяется wire-представление: именно его прочитает будущий handler.
      // Обычный stringify молча удаляет undefined/functions и заменяет NaN на null;
      // replacer отклоняет такие значения, когда они встречаются при обходе.
      // Стандартный toJSON выполняется до replacer: проверяется результат toJSON.
      message = JSON.stringify(input, (_key, value: unknown) => {
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
          || typeof value === 'bigint' || (typeof value === 'number' && !Number.isFinite(value))) {
          throw new EventContractError('INVALID_JSON');
        }
        return value;
      });
    } catch {
      // Circular references, BigInt и пользовательский toJSON могут бросить ошибки
      // с деталями input; не переносим эти ошибки или их message в диагностику.
      throw new EventContractError('INVALID_JSON');
    }
    // Повторно используем consumer-путь: одинаковые schemas и limits на обеих границах.
    // JSON.parse внутри создаёт копию, не связанную ссылками с исходным объектом.
    return { event: this.parseForHandler(message), message };
  }

  /**
   * Разбирает JSON и допускает событие к будущему handler только после полной проверки.
   *
   * @param message Несжатый JSON после декодирования транспортом; размер измеряется в UTF-8.
   * @returns Известное событие вместе с сохранёнными неизвестными optional fields.
   * @throws EventContractError с безопасным стабильным кодом отказа.
   *
   * До успешного возврата caller не должен запускать эффект или записывать successful marker.
   * Повторная проверка не выполняет бизнес-дедупликацию и не подтверждает доставку.
   */
  parseForHandler(message: string): KnownEvent {
    // Runtime guard нужен даже при TS string: внешние JS callers могут нарушить сигнатуру.
    if (typeof message !== 'string') throw new EventContractError('INVALID_JSON');
    // Сначала bytes, затем parse: слишком большое сообщение не разбираем в дерево объектов.
    if (Buffer.byteLength(message, 'utf8') > MAX_EVENT_BYTES) throw new EventContractError('MESSAGE_TOO_LARGE');
    let input: unknown;
    try {
      input = JSON.parse(message);
    } catch {
      // SyntaxError JSON.parse иногда содержит фрагмент входа; наружу передаём только код.
      throw new EventContractError('INVALID_JSON');
    }
    // JSON допускает null/array/primitives, но envelope должен быть объектом.
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EventContractError('INVALID_EVENT');
    const header = input as Record<string, unknown>;
    // Это минимальная проверка для выбора schema, а не валидация всего envelope.
    // Некорректный номер версии отличается от корректной, но неподдерживаемой версии.
    if (typeof header.type !== 'string' || header.type.length === 0
      || !Number.isSafeInteger(header.schemaVersion) || (header.schemaVersion as number) < 1) {
      throw new EventContractError('INVALID_EVENT');
    }
    const key = `${header.type}:${header.schemaVersion}`;
    // Проверяем собственную запись registry, не свойства Object.prototype.
    if (!Object.hasOwn(EVENT_REGISTRY, key)) throw new EventContractError('UNSUPPORTED_EVENT');
    const validate = EVENT_REGISTRY[key as keyof typeof EVENT_REGISTRY];
    // Только теперь проверяются все поля envelope, вложенный payload, formats и bounds.
    // Детали validate.errors не возвращаем: публичный отказ не должен раскрывать input.
    if (!validate(input)) throw new EventContractError('INVALID_EVENT');
    return input;
  }
}
