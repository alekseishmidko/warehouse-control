/** @file Недоверенный login input: ASCII username и ограниченный пароль, без actor/role из клиента. */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
/** Ввод входа: пароль не преобразуется и не включается в сообщения validation errors. */
export class LoginDto {
  /** ASCII login нормализуется lowercase, без зависимости от locale/collation БД. */
  @ApiProperty({ example: 'operator.one', minLength: 3, maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/)
  login!: string;
  /** Ограничение длины предотвращает неограниченную работу password hashing. */
  @ApiProperty({ writeOnly: true, minLength: 15, maxLength: 128 })
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  password!: string;
}
