/** @file Недоверенный состав заказа ADR-0022: один склад, уникальность товаров проверяет сервис. */
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
/** Строка заказа: положительное int4 quantity без автоматического преобразования строки в число. */
export class OrderLineInputDto {
  /** Существующий товар; format UUID не доказывает наличие в catalog. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  /** Целые штуки; int4 одинаков для JSON, SQL и inventory. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
/** Создание draft не резервирует stock; server-side actor/status клиент не выбирает. */
export class CreateOrderDto {
  /** Один существующий склад; права проверяются до dedup. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  /** 1..1000 разных productId; duplicate detection нечувствителен к регистру UUID. */
  @ApiProperty({ type: [OrderLineInputDto], minItems: 1, maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];
}
