/** @file Публичный output WMS-204: явный безопасный JSON snapshot, без ORM классов. */
import { ApiProperty } from '@nestjs/swagger';

/** GET актуален; replay возвращает снимок исходного commit. */
export class AllocationDto {
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
