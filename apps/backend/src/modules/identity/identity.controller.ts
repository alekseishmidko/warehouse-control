/** @file Session HTTP: JSON login/me/logout без сохранения credentials в HTTP idempotency; cookie только после commit. */
import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { Principal } from './dto/principal.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { CurrentUserDto } from './dto/current-user.dto';
import { AuthService } from './services/auth.service';
import { UsersService } from './services/users.service';
import { IDENTITY_CONFIG, IdentityConfig } from './identity.config';
import {
  clearSessionCookie,
  IdentityAccess,
  SessionPrincipal,
  sessionToken,
  writeSessionCookie,
} from './identity.http';
import { sessionCsrf } from '../../shared/security/secrets';
/** Guard допускает login только с exact Origin/JSON/custom header, self только с живой сессией. */
@ApiTags('identity')
@Controller('auth')
export class IdentityController {
  /** Сервис выполняет SQL и hash, transport управляет только cookie/response. */
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}
  /** При неверных credentials общий 401, при лимите 429; password/session token никогда не отражаются JSON. */
  @Post('login')
  @IdentityAccess('login')
  @ApiBody({ type: LoginDto })
  @ApiOperation({ summary: 'Войти по логину/паролю; серверная cookie-сессия' })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Protection', required: true, schema: { type: 'string', enum: ['1'] } })
  @ApiResponse({
    status: 200,
    type: LoginResponseDto,
    description: 'Безопасный user и csrfToken; session token только в HttpOnly Set-Cookie.',
  })
  @ApiResponse({
    status: 401,
    description: 'Неверные credentials или заблокированный пользователь.',
  })
  @ApiResponse({ status: 429, description: 'Окно попыток входа исчерпано.' })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.auth.login(input, request.socket.remoteAddress ?? 'unknown');
    response.setHeader('Cache-Control', 'no-store');
    writeSessionCookie(response, this.config, result.token);
    response.status(200).json({ user: result.user, csrfToken: result.csrfToken });
  }
  /** Собственный профиль/grants и CSRF для нового browser tab, без доступа к session token из JavaScript. */
  @Get('me')
  @IdentityAccess('self')
  @ApiCookieAuth('session')
  @ApiResponse({
    status: 200,
    type: CurrentUserDto,
    description: 'Текущий user, его warehouseRoles, csrfToken.',
  })
  async me(
    @SessionPrincipal() principal: Principal,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.users.current(principal);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Cookie');
    response.json({
      ...result,
      csrfToken: sessionCsrf(sessionToken(request, this.config)!),
    });
  }
  /** Отзывает текущую session в БД, затем очищает cookie; требуется CSRF и exact Origin. */
  @Post('logout')
  @IdentityAccess('self')
  @ApiCookieAuth('session')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 204, description: 'Текущая сессия отозвана, cookie очищена.' })
  async logout(@SessionPrincipal() principal: Principal, @Res() response: Response): Promise<void> {
    await this.auth.logout(principal);
    clearSessionCookie(response, this.config);
    response.setHeader('Cache-Control', 'no-store');
    response.status(204).end();
  }
}
