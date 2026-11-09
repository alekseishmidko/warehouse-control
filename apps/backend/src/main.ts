/**
 * @file Точка запуска HTTP: создаёт Nest-приложение и включает shutdown hooks.
 * Валидирует окружение до запуска; ошибка старта не раскрывает credentials, exit code 1.
 */
import 'reflect-metadata';
import { runApiProcess } from './infrastructure/lifecycle/api-process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnvironment } from './infrastructure/config/environment';
import { configureHttp } from './infrastructure/http/configure-http';

/** Запускает HTTP listener; ошибки создания и bind передаются вызывающему коду. */
async function bootstrap(): Promise<void> {
  const config = loadEnvironment();
  await runApiProcess(
    async () => {
      const app = await NestFactory.create(AppModule, { abortOnError: false });
      configureHttp(app);
      return app;
    },
    config.port,
    config.httpHost,
  );
}

void bootstrap().catch(() => {
  console.error(
    'Application startup failed. Check NODE_ENV, PORT, DATABASE_URL and database availability.',
  );
  process.exitCode = 1;
});
