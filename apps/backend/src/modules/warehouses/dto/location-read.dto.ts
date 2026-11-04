/** @file Публичный LocationRead DTO для справочных списков; собственная явная проекция. */
import { ApiProperty } from '@nestjs/swagger';
/** Идентификаторы выбираются в UI, но владелец команды заново проверяет refs и права. */
export class LocationReadDto {
  /** UUID объекта справочника; не предоставляет доступ сам по себе. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** UUID фактического склада ячейки. */ @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  /** Читаемый код объекта; не заменяет UUID при записи команды. */ @ApiProperty({}) code!: string;
  /** Назначение зоны: receiving/storage/shipping. */ @ApiProperty({
    enum: ['receiving', 'storage', 'shipping'],
  })
  kind!: string;
}
