/** @file API lifecycle с настоящим HTTP listener: drain активного response и signal до bind, без PostgreSQL. */
import * as logging from '@backend/infrastructure/logging/runtime-logger';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { ProcessHealth } from '@backend/infrastructure/lifecycle/process-health';
import { runApiProcess } from '@backend/infrastructure/lifecycle/api-process';
@Module({
  providers: [{ provide: ProcessHealth, useFactory: () => new ProcessHealth(async () => {}) }],
})
class ProbeTestModule {}

test('AC-304-02: API drain waits for active response and removes its signal handlers', async () => {
  const listeners = new Set(process.listeners('SIGTERM'));
  const original = listeners.size;
  const signal = () =>
    process
      .listeners('SIGTERM')
      .find((listener) => !listeners.has(listener))
      ?.call(process, 'SIGTERM');
  const app = await NestFactory.create(ProbeTestModule, { logger: false });
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handling = new Promise<void>((resolve) => {
    started = resolve;
  });
  app.use((_request: Request, response: Response) => {
    started();
    held.then(() => response.status(200).end()).catch(() => response.destroy());
  });
  const server: unknown = app.getHttpServer();
  if (!(server instanceof Server)) throw new Error('HTTP server required');
  const listening = new Promise<void>((resolve) => server.once('listening', resolve));
  const running = runApiProcess(async () => app, 0, '127.0.0.1').then(
    () => ({ ok: true }),
    (error: unknown) => ({ error }),
  );
  let active: Promise<number> | undefined;
  try {
    await Promise.race([
      listening,
      running.then((result) => {
        if ('error' in result) throw result.error;
        throw new Error('API exited before bind');
      }),
    ]);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    active = fetch(origin + '/').then(
      (r) => r.status,
      () => -1,
    );
    await handling;
    // Вызываем только handler проверяемого процесса, не signal listeners Jest.
    signal();
    expect(app.get(ProcessHealth).draining).toBe(true);
    await expect(fetch(origin + '/new')).rejects.toThrow();
    release();
    expect(await active).toBe(200);
    expect(await running).toEqual({ ok: true });
    expect(process.listenerCount('SIGTERM')).toBe(original);
  } finally {
    release();
    signal();
    await running;
    await active;
  }
});

test('AC-304-02: signal during startup prevents the HTTP listener from opening', async () => {
  const listeners = new Set(process.listeners('SIGTERM'));
  const app = await NestFactory.create(ProbeTestModule, { logger: false });
  let release!: () => void;
  const factory = new Promise<typeof app>((resolve) => {
    release = () => resolve(app);
  });
  const running = runApiProcess(() => factory, 0, '127.0.0.1');
  process
    .listeners('SIGTERM')
    .find((listener) => !listeners.has(listener))
    ?.call(process, 'SIGTERM');
  release();
  await running;
  const server: unknown = app.getHttpServer();
  expect(server instanceof Server && server.listening).toBe(false);
  expect(app.get(ProcessHealth).draining).toBe(true);
});

test('startup failure rejects and removes signal listeners', async () => {
  const before = process.listenerCount('SIGTERM');
  await expect(
    runApiProcess(
      async () => {
        throw new Error('startup failed');
      },
      0,
      '127.0.0.1',
    ),
  ).rejects.toThrow('startup failed');
  expect(process.listenerCount('SIGTERM')).toBe(before);
});

test('AC-304-02: hanging startup reaches the process deadline; repeated signal does not extend it', async () => {
  const app = await NestFactory.create(ProbeTestModule, { logger: false });
  const listeners = new Set(process.listeners('SIGTERM'));
  let release!: () => void;
  const factory = new Promise<typeof app>((resolve) => {
    release = () => resolve(app);
  });
  // Unit наблюдает намерение завершить процесс; настоящий kill/rollback проверяется Pod/child gates.
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('hard deadline');
  });
  const log = jest.spyOn(logging, 'logEvent').mockImplementation(() => {});
  jest.useFakeTimers();
  const running = runApiProcess(() => factory, 0, '127.0.0.1');
  try {
    const signal = process.listeners('SIGTERM').find((listener) => !listeners.has(listener));
    expect(signal).toBeDefined();
    signal?.call(process, 'SIGTERM');
    jest.advanceTimersByTime(10000);
    signal?.call(process, 'SIGTERM');
    expect(() => jest.advanceTimersByTime(10000)).toThrow('hard deadline');
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith('api.shutdown_deadline');
  } finally {
    release();
    await running;
    jest.useRealTimers();
    exit.mockRestore();
    log.mockRestore();
  }
});

test('AC-304-02: signal during asynchronous Nest init prevents a late listener bind', async () => {
  let release!: () => void, initialized!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    initialized = resolve;
  });
  @Module({
    providers: [
      { provide: ProcessHealth, useFactory: () => new ProcessHealth(async () => {}) },
      {
        provide: 'delayed-init',
        useValue: {
          onModuleInit: async () => {
            initialized();
            await barrier;
          },
        },
      },
    ],
  })
  class DelayedInitModule {}
  const app = await NestFactory.create(DelayedInitModule, { logger: false });
  const before = new Set(process.listeners('SIGTERM'));
  let bound = false;
  const server: unknown = app.getHttpServer();
  if (!(server instanceof Server)) throw new Error('HTTP server required');
  server.on('listening', () => {
    bound = true;
  });
  const running = runApiProcess(async () => app, 0, '127.0.0.1');
  try {
    await waiting;
    process
      .listeners('SIGTERM')
      .find((listener) => !before.has(listener))
      ?.call(process, 'SIGTERM');
    release();
    await running;
    expect(bound).toBe(false);
  } finally {
    release();
    await running;
  }
});

test('AC-304-02: rejected cleanup retains the hard deadline instead of hanging indefinitely', async () => {
  const app = await NestFactory.create(ProbeTestModule, { logger: false });
  const originalClose = app.close.bind(app);
  // NestFactory возвращает Proxy; отдельная test-only обёртка инъецирует отказ close,
  // сохраняя настоящий HTTP/Nest lifecycle остальных методов.
  const failing = new Proxy(app, {
    get(target, key, receiver) {
      if (key === 'close')
        return async () => {
          throw new Error('cleanup failed');
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const before = new Set(process.listeners('SIGTERM'));
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('hard deadline');
  });
  const log = jest.spyOn(logging, 'logEvent').mockImplementation(() => {});
  jest.useFakeTimers();
  const running = runApiProcess(async () => failing, 0, '127.0.0.1');
  const rejected = expect(running).rejects.toThrow('cleanup failed');
  try {
    process
      .listeners('SIGTERM')
      .find((listener) => !before.has(listener))
      ?.call(process, 'SIGTERM');
    await rejected;
    expect(() => jest.advanceTimersByTime(20000)).toThrow('hard deadline');
    expect(exit).toHaveBeenCalledWith(1);
  } finally {
    jest.useRealTimers();
    exit.mockRestore();
    log.mockRestore();
    await originalClose();
  }
});
