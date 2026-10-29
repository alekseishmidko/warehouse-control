/** @file Публичная связка warehouseId/role собственного пользователя, не две независимые области прав. */
import { ApiProperty } from '@nestjs/swagger';
import { WAREHOUSE_ROLES, WarehouseRole } from './warehouse-role.types';
/** Одно warehouse-scoped назначение, не декартово произведение двух независимых списков. */
export class WarehouseGrantDto {
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ enum: WAREHOUSE_ROLES }) role!: WarehouseRole;
}
