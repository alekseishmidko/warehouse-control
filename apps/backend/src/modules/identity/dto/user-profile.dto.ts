/** @file Публичный безопасный профиль для OpenAPI/JSON; password hash/session token здесь отсутствуют. */
import { ApiProperty } from '@nestjs/swagger';
/** Публичный профиль: выбор полей явный, passwordHash/токен/внутренний ORM объект исключены. */
export class UserProfileDto {
  /** Стабильная server-side идентичность субъекта. */
  @ApiProperty({ format: 'uuid' }) id!: string;
  /** Нормализованное имя входа, не email/секрет. */
  @ApiProperty() login!: string;
  /** Текущая активность аккаунта; blocked сессия не получает этот ответ. */
  @ApiProperty() active!: boolean;
  /** Global identity role не выдаёт складские permissions. */
  @ApiProperty() systemAdmin!: boolean;
}
