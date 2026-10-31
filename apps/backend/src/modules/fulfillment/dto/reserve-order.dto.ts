/** @file Явные количества резервирования: сервер не уменьшает запрос при нехватке доступного stock. */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
/** Количество одной существующей строки именно выбранного заказа. */
export class ReserveOrderLineDto {
  /** Ссылка на строку, не на произвольный товар; принадлежность проверяется под order lock. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() lineId!: string;
  /** Запрошенное количество целых штук; сумма не может превышать открытый остаток строки. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
/** Весь вектор выполняется атомарно; явная часть заказа допустима, молчаливое уменьшение вектора — нет. */
export class ReserveOrderDto {
  /** 1..1000 уникальных lineId; повтор строк отклоняет сервис. */
  @ApiProperty({ type: [ReserveOrderLineDto], minItems: 1, maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ReserveOrderLineDto)
  lines!: ReserveOrderLineDto[];
}
