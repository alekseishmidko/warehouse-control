/** @file Administrative identity HTTP: только global system_admin + CSRF, каждый эффект с повторной проверкой внутри transaction. */
import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CreateUserDto } from './dto/create-user.dto';
import { Principal } from './dto/principal.dto';
import { SetWarehouseRolesDto } from './dto/set-warehouse-roles.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { IdentityAccess, SessionPrincipal } from './identity.http';
import { UsersService } from './services/users.service';
import { correlationIdOf } from '../../infrastructure/http/request-context';
/** Credentials не проходят business command cache: SHA-256 request fingerprint мог бы ослабить password hashing. */
@ApiTags('identity-administration')
@ApiCookieAuth('session')
@IdentityAccess('admin')
@ApiHeader({ name: 'X-CSRF-Token', required: true })
@Controller('identity/users')
export class IdentityAdminController {
  /** Только публичный сервис; SQL и password hashes controller не получает. */
  constructor(private readonly users: UsersService) {}
  /** Создаёт пользователя; duplicate login даёт 409, не возвращает credential hash. */
  @Post()
  @ApiResponse({ status: 201, type: UserProfileDto, description: 'Созданный безопасный профиль.' })
  create(
    @SessionPrincipal() principal: Principal,
    @Body() input: CreateUserDto,
    @Req() request: Request,
  ) {
    return this.users.createUser(principal, input, correlationIdOf(request));
  }
  /** Блокировка/смена пароля отзывает target sessions; последний active admin защищён. */
  @Patch(':userId')
  @ApiResponse({
    status: 200,
    type: UserProfileDto,
    description: 'Обновлённый безопасный профиль.',
  })
  update(
    @SessionPrincipal() principal: Principal,
    @Param('userId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateUserDto,
    @Req() request: Request,
  ) {
    return this.users.updateUser(principal, id, input, correlationIdOf(request));
  }
  /** Заменяет grants одного склада; пустой массив отзывает их, не затрагивая другой warehouse. */
  @Post(':userId/warehouses/:warehouseId/roles')
  @ApiResponse({ status: 201, description: 'Роли целевого склада заменены.' })
  async roles(
    @SessionPrincipal() principal: Principal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Body() input: SetWarehouseRolesDto,
    @Req() request: Request,
  ) {
    await this.users.setRoles(
      principal,
      userId,
      warehouseId,
      input.roles,
      correlationIdOf(request),
    );
    return { updated: true };
  }
  /** Отзывает все сессии target user без необходимости получать секреты/список токенов. */
  @Delete(':userId/sessions')
  @ApiResponse({ status: 200, description: 'Все сессии пользователя отозваны.' })
  async revokeAll(
    @SessionPrincipal() principal: Principal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() request: Request,
  ) {
    await this.users.revokeSession(principal, userId, undefined, correlationIdOf(request));
    return { revoked: true };
  }
  /** Адресный отзыв: userId+sessionId не позволяют затронуть чужой target без admin-проверки. */
  @Delete(':userId/sessions/:sessionId')
  @ApiResponse({ status: 200, description: 'Сессия адресно отозвана.' })
  async revoke(
    @SessionPrincipal() principal: Principal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() request: Request,
  ) {
    await this.users.revokeSession(principal, userId, sessionId, correlationIdOf(request));
    return { revoked: true };
  }
}
