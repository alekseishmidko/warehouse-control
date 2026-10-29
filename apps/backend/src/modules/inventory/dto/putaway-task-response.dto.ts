/** @file Публичный снимок задания: бизнес-поля и диагностические UUID, без ORM типов и прав из клиента. */
import { ApiProperty } from '@nestjs/swagger';
import type { PutawayTaskDto } from './putaway-task.dto';
/** GET показывает текущее состояние; idempotent command replay возвращает сохранённый снимок completion. */
export class PutawayTaskResponseDto implements PutawayTaskDto {
  /** UUID задания. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** Исходная приёмка. */ @ApiProperty({ format: 'uuid' }) sourceReceiptId!: string;
  /** Строка приёмки, одна task на строку. */ @ApiProperty({ format: 'uuid' })
  sourceReceiptLineId!: string;
  /** EventId приёмки, не факт выполнения. */ @ApiProperty({ format: 'uuid' })
  sourceEventId!: string;
  /** Склад обеих ячеек. */ @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  /** Неизменная receiving ячейка. */ @ApiProperty({ format: 'uuid' }) sourceLocationId!: string;
  /** Товар задания. */ @ApiProperty({ format: 'uuid' }) productId!: string;
  /** Полное количество int4 в штуках. */ @ApiProperty({ minimum: 1, maximum: 2147483647 })
  quantity!: number;
  /** Однократный переход pending → completed. */ @ApiProperty({ enum: ['pending', 'completed'] })
  status!: 'pending' | 'completed';
  /** Назначение, отсутствует до выполнения. */ @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
  })
  targetLocationId!: string | null;
  /** UTC ISO бизнес-время выполнения. */ @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  completedAt!: string | null;
  /** Событие выполнения, retained outbox. */ @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
  })
  completedEventId!: string | null;
  /** Audit выполнения, не создания. */ @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
  })
  completionAuditId!: string | null;
  /** Audit создания задания worker. */ @ApiProperty({ format: 'uuid' }) auditId!: string;
  /** UTC ISO создания задания. */ @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
