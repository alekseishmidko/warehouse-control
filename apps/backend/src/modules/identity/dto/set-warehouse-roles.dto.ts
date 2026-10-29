/** @file Недоверенная полная замена ролей одного склада; [] отзывает только его grants. */
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayUnique, ArrayMaxSize, IsIn } from 'class-validator';
import { WAREHOUSE_ROLES, WarehouseRole } from './warehouse-role.types';
/** Полная замена ролей на одном складе; пустой массив отзывает доступ. */
export class SetWarehouseRolesDto {
  /** Полный новый набор, а не добавление; [] снимает все роли только указанного склада. */
  @ApiProperty({ enum: WAREHOUSE_ROLES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsIn(WAREHOUSE_ROLES, { each: true })
  roles!: WarehouseRole[];
}
