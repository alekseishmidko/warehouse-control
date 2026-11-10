/**
 * @file Точка запуска HTTP: создаёт Nest-приложение и включает shutdown hooks.
 * Валидирует окружение до запуска; ошибка старта не раскрывает credentials, exit code 1.
 */
import { logEvent } from './infrastructure/logging/runtime-logger';
import './infrastructure/logging/startup';
import 'reflect-metadata';
import { nestLogger } from './infrastructure/logging/runtime-logger';
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
      const app = await NestFactory.create(AppModule, { abortOnError: false, logger: nestLogger });
      configureHttp(app);
      return app;
    },
    config.port,
    config.httpHost,
  );
}

void bootstrap().catch(() => {
  logEvent('api.failed');
  process.exitCode = 1;
});
