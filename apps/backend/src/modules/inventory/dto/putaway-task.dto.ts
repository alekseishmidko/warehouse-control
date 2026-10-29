/** @file Внутренний inventory API планирования: проверенный receipt event и server-side audit metadata, без HTTP/ORM. */
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
/** Вход всё равно runtime проверяется владельцем inventory; context worker передаётся отдельно. */
export interface CreatePutawayTasksDto extends OperationMetadata {
  readonly event: KnownEvent;
}
/** Основание задания неизменно; выполнение однократно фиксирует target/completion, отмены и partial execution нет. */
export interface PutawayTaskDto {
  readonly id: string;
  readonly sourceReceiptId: string;
  readonly sourceReceiptLineId: string;
  readonly sourceEventId: string;
  readonly warehouseId: string;
  readonly sourceLocationId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly status: 'pending' | 'completed';
  /** UUID storage ячейки, NULL до выполнения. */
  readonly targetLocationId: string | null;
  /** UTC ISO дата, NULL до выполнения. */
  readonly completedAt: string | null;
  /** Outbox eventId выполнения, NULL до выполнения. */
  readonly completedEventId: string | null;
  /** AuditId выполнения; исходный auditId создания не заменяется. */
  readonly completionAuditId: string | null;
  readonly auditId: string;
  readonly createdAt: string;
}
