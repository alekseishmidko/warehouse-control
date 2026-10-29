/** @file Admin input создания пользователя: наследует ограничения credentials, global admin не даёт warehouse grants. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';
import { LoginDto } from './login.dto';
/** Создание пользователя доступно только system_admin; публичной регистрации нет. */
export class CreateUserDto extends LoginDto {
  /** Глобальная identity-роль; не создаёт warehouse grants. Только существующий admin может её назначить. */
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() systemAdmin?: boolean;
}
