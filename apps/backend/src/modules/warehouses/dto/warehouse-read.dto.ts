/** @file Публичный WarehouseRead DTO для справочных списков; собственная явная проекция. */
import { ApiProperty } from '@nestjs/swagger';
/** Идентификаторы выбираются в UI, но владелец команды заново проверяет refs и права. */
export class WarehouseReadDto {
  /** UUID объекта справочника; не предоставляет доступ сам по себе. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** Читаемый код объекта; не заменяет UUID при записи команды. */ @ApiProperty({}) code!: string;
  /** Читаемое название без внутренних полей ORM. */ @ApiProperty({}) name!: string;
}
