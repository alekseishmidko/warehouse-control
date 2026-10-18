/** @file Nest AuditModule: private repository и публичный AuditService; внешнего HTTP пока нет. */
import { Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { AuditRepository } from './repositories/audit.repository';

/** Регистрирует единственного владельца записи аудита; schema migrations выполняются отдельно. */
@Module({ providers: [AuditRepository, AuditService], exports: [AuditService] })
export class AuditModule {}
