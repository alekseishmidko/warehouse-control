/** @file Child-only API lifecycle fixture: настоящий AppModule и IPC barrier активного HTTP response. */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, Response, NextFunction } from 'express';
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(resolve('dist/app.module'));
const { configureHttp } = require(resolve('dist/infrastructure/http/configure-http'));
const { runApiProcess } = require(resolve('dist/infrastructure/lifecycle/api-process'));
import type { INestApplication } from '@nestjs/common';
/** Barrier существует только в тестовом middleware и не входит в production graph/image. */
async function start(): Promise<void> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  process.on('message', (message) => {
    if (message === 'release') release();
  });
  await runApiProcess(
    async () => {
      const app: INestApplication = await NestFactory.create(AppModule, {
        logger: false,
        abortOnError: false,
      });
      configureHttp(app);
      app.use((request: Request, response: Response, next: NextFunction) => {
        if (request.path !== '/test-hold') {
          next();
          return;
        }
        process.send?.('handling');
        barrier.then(() => response.status(200).end()).catch(next);
      });
      // Слушаем реальный bind, не подменяя overloaded app.listen.
      const server: unknown = app.getHttpServer();
      if (!(server instanceof Server)) throw new Error('HTTP server required');
      server.once('listening', () =>
        process.send?.({ port: (server.address() as AddressInfo).port }),
      );
      return app;
    },
    0,
    '127.0.0.1',
  );
  process.disconnect?.();
}
void start().catch(() => {
  process.exitCode = 1;
  process.disconnect?.();
});
