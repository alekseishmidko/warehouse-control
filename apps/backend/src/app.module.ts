/** @file Корневой composition root: связывает стартовые HTTP routes и сервис. */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/** Регистрирует каркас; бизнес-модули и инфраструктура пока не подключены. */
@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
