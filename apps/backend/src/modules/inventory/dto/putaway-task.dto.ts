/** @file Внутренний inventory API планирования: проверенный receipt event и server-side audit metadata, без HTTP/ORM. */
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
/** Вход всё равно runtime проверяется владельцем inventory; context worker передаётся отдельно. */
export interface CreatePutawayTasksDto extends OperationMetadata { readonly event: KnownEvent; }
/** Неизменяемое задание первого сценария; назначения/исполнения/отмены пока нет, состояние только pending. */
export interface PutawayTaskDto {
  readonly id: string; readonly sourceReceiptId: string; readonly sourceReceiptLineId: string; readonly sourceEventId: string;
  readonly warehouseId: string; readonly sourceLocationId: string; readonly productId: string; readonly quantity: number;
  readonly status: 'pending'; readonly auditId: string; readonly createdAt: string;
}
