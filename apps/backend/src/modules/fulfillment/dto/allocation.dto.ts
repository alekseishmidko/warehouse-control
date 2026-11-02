/** @file Публичный output WMS-204: явный безопасный JSON snapshot, без ORM классов. */
import { ApiProperty } from '@nestjs/swagger';

/** GET актуален; replay возвращает снимок исходного commit. */
export class AllocationDto {
  /** Исторически отгруженные штуки, не active резерв. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  consumed!: number;
  /** UUID физической ячейки, не полномочие доступа. */ @ApiProperty({ format: 'uuid' })
  locationId!: string;
  /** Производное состояние, не отдельный изменяемый клиентом флаг. */ @ApiProperty({
    enum: ['active', 'transferred', 'consumed', 'released', 'closed_mixed'],
  })
  state!: string;
  /** Исторически перенесённые штуки; не release и не активный резерв этого balance. */ @ApiProperty(
    { type: 'integer', minimum: 0, maximum: 2147483647 },
  )
  transferred!: number;
  /** Зона фактического balance определяет reservedStorage/reservedShipping. */ @ApiProperty({
    enum: ['storage', 'shipping'],
  })
  locationKind!: string;
  /** UUID основания. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** Конкретная позиция хранения. */ @ApiProperty({ format: 'uuid' }) balanceId!: string;
  /** Исходное количество. */ @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  allocated!: number;
  /** Активное количество. */ @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647 })
  active!: number;
  /** Накопленное освобождение. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  released!: number;
}
