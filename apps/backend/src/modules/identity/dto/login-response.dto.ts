/** @file Login response: user и CSRF для same-origin UI; session token выдаётся только HttpOnly cookie. */
import { ApiProperty } from '@nestjs/swagger';
import { UserProfileDto } from './user-profile.dto';
/** CSRF доступен JavaScript по same-origin JSON; session token остаётся только HttpOnly cookie. */
export class LoginResponseDto {
  @ApiProperty({ type: UserProfileDto }) user!: UserProfileDto;
  /** Значение связано с текущей сессией; передавать X-CSRF-Token, не хранить в логах. */
  @ApiProperty({ minLength: 43, maxLength: 43 }) csrfToken!: string;
}
