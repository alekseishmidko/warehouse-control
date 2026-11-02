/** @file Публичный immutable состав shipment, без ORM полей. */
import { ApiProperty } from '@nestjs/swagger';
/** UUID строки также уникальное основание consumption. */
export class ShipmentLineDto {
  /** UUID строки. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** UUID shipping allocation. */ @ApiProperty({ format: 'uuid' }) allocationId!: string;
  /** Положительное int4 в штуках. */ @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
  })
  quantity!: number;
}
