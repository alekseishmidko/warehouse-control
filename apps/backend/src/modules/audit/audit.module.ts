/** @file Nest AuditModule: private repositories и публичные write/read services; API adapter подключается только в AppModule. */
import { AuditReadRepository } from './repositories/audit-read.repository';
import { AuditReadService } from './services/audit-read.service';
import { Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { AuditRepository } from './repositories/audit.repository';

/** Регистрирует единственного владельца записи аудита; schema migrations выполняются отдельно. */
@Module({
  providers: [AuditReadRepository, AuditReadService, AuditRepository, AuditService],
  exports: [AuditReadService, AuditService],
})
export class AuditModule {}
