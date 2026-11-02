/** @file Недоверенный полный вектор физического возврата B3; частичная компенсация не предоставлена. */
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ReasonDto } from './reason.dto';
import { CancellationReturnLineDto } from './cancellation-return-line.dto';
/** Не более 1000 order lines даже при множестве shipping allocations на один товар. */
export class CancellationReturnDto extends ReasonDto {
  /** Все и только строки заказа с active shipping, без дублей. */ @ApiProperty({
    type: [CancellationReturnLineDto],
    minItems: 1,
    maxItems: 1000,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CancellationReturnLineDto)
  lines!: CancellationReturnLineDto[];
}
