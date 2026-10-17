/** @file Корневой composition root: связывает стартовые HTTP routes и сервис. */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';

/** Регистрирует HTTP-каркас и PostgreSQL; складские бизнес-модули ещё не подключены. */
@Module({
  imports: [DatabaseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
