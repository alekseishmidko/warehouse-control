/** @file Полный физический возврат одной строки заказа: quantity суммирует все её shipping allocations. */
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max } from 'class-validator';
/** Источники shipping сервер читает сам; оператор подтверждает весь staged остаток строки. */
export class CancellationReturnLineDto {
  /** UUID order line, а не picking line. */ @ApiProperty({ format: 'uuid' })
  @IsUUID()
  lineId!: string;
  /** Storage ячейка того же склада. */ @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetLocationId!: string;
  /** int4 штуки, точно равные active shipping этой строки. */ @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
