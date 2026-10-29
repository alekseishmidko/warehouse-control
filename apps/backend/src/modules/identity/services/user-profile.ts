/** @file Общая внутри identity явная проекция DB snapshot в безопасный публичный профиль; shared не зависит от users. */
import type { UserRow } from '../repositories/identity.repository';
import type { UserProfileDto } from '../dto/user-profile.dto';
/**
 * Принимает только внутреннюю прочитанную строку users и копирует allowlist полей.
 * Не выполняет I/O; добавление DB columns не раскрывает hash в login/admin/current JSON.
 * @returns Профиль без password_hash и session secrets.
 */
export function toUserProfile(user: UserRow): UserProfileDto {
  return { id: user.id, login: user.login, active: user.active, systemAdmin: user.system_admin };
}
