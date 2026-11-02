/** @file Проверенный код причины: не свободный текст и не место для персональных данных. */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
/** Причина включается в audit; actor/roles клиент не задаёт. */
export class ReasonDto {
  /** ASCII код 3..64, обязательный без default. */ @ApiProperty({
    pattern: '^[a-z][a-z0-9.-]{2,63}$',
    minLength: 3,
    maxLength: 64,
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9.-]{2,63}$/)
  reasonCode!: string;
}
