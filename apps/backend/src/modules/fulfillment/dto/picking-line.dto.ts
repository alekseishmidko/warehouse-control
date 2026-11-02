/** @file Публичный снимок строки сборки: quantities в целых штуках, без ORM-моделей. */
import { ApiProperty } from '@nestjs/swagger';
/** План сохраняется; pickedTotal — исторический факт, remaining — ещё не выполненная часть. */
export class PickingLineDto {
  /** UUID строки. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** UUID источника резерва, не полномочие доступа. */ @ApiProperty({ format: 'uuid' })
  allocationId!: string;
  /** int4 план в штуках. */ @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  planned!: number;
  /** int4 исторически собранные штуки. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  pickedTotal!: number;
  /** int4 отменённая несобранная часть. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  cancelledUnpicked!: number;
  /** int4 planned-pickedTotal-cancelledUnpicked. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  remaining!: number;
}
