/** @file Корневой composition root: связывает технический HTTP, PostgreSQL и audit. */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuditModule } from './modules/audit/audit.module';

/** Регистрирует HTTP-каркас и PostgreSQL; складские бизнес-модули ещё не подключены. */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
