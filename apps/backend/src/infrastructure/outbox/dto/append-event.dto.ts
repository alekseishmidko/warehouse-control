/** @file Внутренний write interface outbox: producer задаёт факт, writer владеет eventId и aggregateVersion. */
import type { KnownEvent, ReceivingPostedPayload } from '../../../shared/events/dto/event.dto';

/**
 * Команда записи события, не HTTP DTO. Context передаётся отдельным обязательным аргументом.
 * Поля объявлены явно: Omit от generated type с index signature потерял бы известные свойства.
 * Неизвестные optional extensions разрешены, но eventId/aggregateVersion задавать запрещено.
 * Payload берётся из generated контракта; все поля дополнительно проверяются runtime.
 */
export interface AppendEventDto {
  type: KnownEvent['type'];
  schemaVersion: KnownEvent['schemaVersion'];
  aggregateType: KnownEvent['aggregateType'];
  /** UUID агрегата: разные регистры записи UUID обозначают один PostgreSQL stream. */
  aggregateId: string;
  /** UTC время бизнес-факта задаёт владелец сценария; created_at БД — отдельное техническое время. */
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  traceparent?: string;
  payload: ReceivingPostedPayload;
  [key: string]: unknown;
}
