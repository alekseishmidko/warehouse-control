/** @file Недоверенная строка staged партии: конкретный allocation и положительные штуки. */
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max } from 'class-validator';
/** Принадлежность shipping/order проверяется сервером под order lock. */
export class PrepareShipmentLineDto {
  /** UUID обеспечения, не идентификатор склада из клиента. */ @ApiProperty({ format: 'uuid' })
  @IsUUID()
  allocationId!: string;
  /** int4 штуки 1..2147483647. */ @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
