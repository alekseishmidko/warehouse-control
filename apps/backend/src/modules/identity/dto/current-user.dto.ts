/** @file Ответ current-user: безопасный профиль, CSRF и собственные складские назначения. */
import { ApiProperty } from '@nestjs/swagger';
import { LoginResponseDto } from './login-response.dto';
import { WarehouseGrantDto } from './warehouse-grant.dto';
/** Собственная identity и grants для UI, без каталога чужих пользователей/складов. */
export class CurrentUserDto extends LoginResponseDto {
  @ApiProperty({ type: [WarehouseGrantDto] }) warehouseRoles!: WarehouseGrantDto[];
}
