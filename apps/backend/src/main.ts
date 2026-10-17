/**
 * @file Точка запуска HTTP: создаёт Nest-приложение и включает shutdown hooks.
 * PORT задаёт порт (default 3000); ошибка запуска завершает процесс с кодом 1.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Запускает HTTP listener; ошибки создания и bind передаются вызывающему коду. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
