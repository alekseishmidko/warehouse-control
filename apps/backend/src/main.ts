/**
 * @file Точка запуска HTTP: создаёт Nest-приложение и включает shutdown hooks.
 * Валидирует окружение до запуска; ошибка старта не раскрывает credentials, exit code 1.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnvironment } from './infrastructure/config/environment';

/** Запускает HTTP listener; ошибки создания и bind передаются вызывающему коду. */
async function bootstrap(): Promise<void> {
  const config = loadEnvironment();
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.enableShutdownHooks();
  try {
    await app.listen(config.port);
  } catch {
    await app.close();
    throw new Error('Application startup failed');
  }
}

void bootstrap().catch(() => {
  console.error('Application startup failed. Check NODE_ENV, PORT, DATABASE_URL and database availability.');
  process.exitCode = 1;
});
