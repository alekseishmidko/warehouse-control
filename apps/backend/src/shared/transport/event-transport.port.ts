/** @file Сетевой transport contract вне business transaction: подтверждение относится к broker, не к DB effect. */
import type { KnownEvent } from '../events/dto/event.dto';
/** Publisher передаёт validated immutable fact; port не получает TransactionContext или SQL. */
// Port не получает TransactionContext: сетевую отправку нельзя включать в business
// SQL callback. Его publish ack относится только к broker; completed в PG записывает caller.
export interface EventTransport {
  /** Проверяет соединение/config/topology, не публикует business event. */
  connect(): Promise<void>;
  /** Возвращает после broker commit ack. Ошибка означает uncertain outcome, прежний eventId повторяется. */
  publish(event: KnownEvent): Promise<void>;
  /** Ограниченно закрывает transport; caller владеет общим shutdown deadline. */
  close(): Promise<void>;
}
