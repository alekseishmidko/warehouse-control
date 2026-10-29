/** @file Identity composition: HTTP controllers и service/repository; сценарии разделены по ответственности без отдельных Nest-модулей. */
import { Module } from '@nestjs/common';
import { DatabaseModule, DATABASE_CONFIG } from '../../infrastructure/database/database.module';
import type { RuntimeConfig } from '../../infrastructure/config/environment';
import { AuditModule } from '../audit/audit.module';
import { AuthService } from './services/auth.service';
import { SessionsService } from './services/sessions.service';
import { UsersService } from './services/users.service';
import { AccessService } from './services/access.service';
import { IdentityTransactionsService } from './services/identity-transactions.service';
import { IdentityRepository } from './repositories/identity.repository';
import { IDENTITY_CONFIG, validateIdentityConfig } from './identity.config';
import { IdentityController } from './identity.controller';
import { IdentityAdminController } from './identity-admin.controller';
/** Worker graph этот модуль не импортирует; DB credentials не превращаются в user identity. */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [IdentityController, IdentityAdminController],
  providers: [
    AuthService,
    SessionsService,
    UsersService,
    AccessService,
    IdentityTransactionsService,
    IdentityRepository,
    {
      provide: IDENTITY_CONFIG,
      inject: [DATABASE_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        validateIdentityConfig({ ...process.env, NODE_ENV: config.nodeEnv }),
    },
  ],
  exports: [AuthService, SessionsService, UsersService, AccessService],
})
export class IdentityModule {}
