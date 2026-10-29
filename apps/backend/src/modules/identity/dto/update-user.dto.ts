/** @file Admin input active/systemAdmin/password: hash клиент не передаёт; обновление контролирует сервис. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
/** Admin update не принимает password hash: новый сырой пароль хешируется сервером вне DB transaction. */
export class UpdateUserDto {
  /** false блокирует login/все session проверки и приводит к server-side отзыву. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  /** Последнего active system_admin нельзя отключить или лишить этой роли. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() systemAdmin?: boolean;
  /** Новый пароль: текущие target sessions отзываются, hash рассчитывается вне DB transaction. */
  @ApiPropertyOptional({ writeOnly: true, minLength: 15, maxLength: 128 })
  @IsOptional()
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  password?: string;
}
