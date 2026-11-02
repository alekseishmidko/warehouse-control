/** @file Недоверенное подтверждение: фактическое приращение в штуках, а не накопленное количество. */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';
/** DTO проверяет форму; связь со строкой, исполнитель и remaining проверяются в транзакции. */
export class ConfirmPickingDto {
  /** UUID строки сохранённого задания; источник allocation выбирает сервер. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() taskLineId!: string;
  /** Целые штуки 0..int4 max. Ноль разрешён сервисом только при shortage=true. */
  @ApiProperty({ minimum: 0, maximum: 2147483647, type: 'integer' })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  actualQuantity!: number;
  /** shipping своего склада, обязателен для положительного количества. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() targetLocationId?: string;
  /** Явное сообщение о нехватке: резерв оставшейся части не освобождается. */
  @ApiProperty() @IsBoolean() shortage!: boolean;
}
