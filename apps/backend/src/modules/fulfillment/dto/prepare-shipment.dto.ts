/** @file Ввод immutable shipment: полный вектор выбранных shipping quantities и причина. */
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ReasonDto } from './reason.dto';
import { PrepareShipmentLineDto } from './prepare-shipment-line.dto';
/** Нормализованный вектор содержит 1..1000 разных allocationId. */
export class PrepareShipmentDto extends ReasonDto {
  /** Дубли после приведения UUID к lowercase запрещает controller до fingerprint. */ @ApiProperty({
    type: [PrepareShipmentLineDto],
    minItems: 1,
    maxItems: 1000,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PrepareShipmentLineDto)
  lines!: PrepareShipmentLineDto[];
}
