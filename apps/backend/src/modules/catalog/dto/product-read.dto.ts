/** @file Публичный ProductRead DTO для справочных списков; собственная явная проекция. */
import { ApiProperty } from '@nestjs/swagger';
/** Идентификаторы выбираются в UI, но владелец команды заново проверяет refs и права. */
export class ProductReadDto {
  /** UUID объекта справочника; не предоставляет доступ сам по себе. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** Уникальный SKU товара. */ @ApiProperty({}) sku!: string;
  /** Читаемое название без внутренних полей ORM. */ @ApiProperty({}) name!: string;
  /** Единица количества; текущая модель поддерживает только piece. */ @ApiProperty({
    enum: ['piece'],
  })
  unit!: string;
}
