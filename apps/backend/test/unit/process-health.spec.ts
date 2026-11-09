/** @file Probes: DB outage не меняет liveness; drain закрывает readiness даже во время DB check. */
import { ProcessHealth } from '@backend/infrastructure/lifecycle/process-health';
import type { AddressInfo } from 'node:net';
test('AC-304-01: startup, readiness and liveness have independent meanings', async () => {
  const db = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const health = new ProcessHealth(db);
  expect(await health.status('/health/startup')).toBe(503);
  expect(await health.status('/health/ready')).toBe(503);
  expect(await health.status('/health/live')).toBe(200);
  expect(db).not.toHaveBeenCalled();
  health.onApplicationBootstrap();
  expect(await health.status('/health/ready')).toBe(200);
  db.mockRejectedValue(new Error('private connection details'));
  expect(await health.status('/health/ready')).toBe(503);
  expect(await health.status('/health/live')).toBe(200);
  expect(await health.status('/health/startup')).toBe(200);
  expect(await health.status('/unknown')).toBe(404);
});
test('AC-304-02: drain wins over an already pending readiness check', async () => {
  let release!: () => void;
  const health = new ProcessHealth(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  health.started = true;
  const pending = health.status('/health/ready');
  health.draining = true;
  release();
  expect(await pending).toBe(503);
});
test('worker listener exposes only GET probes and closes cleanly', async () => {
  const health = new ProcessHealth(async () => {});
  const server = await health.listen(0);
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(origin + '/health/live')).status).toBe(200);
    expect((await fetch(origin + '/health/ready')).status).toBe(503);
    health.started = true;
    expect((await fetch(origin + '/health/ready')).status).toBe(200);
    expect((await fetch(origin + '/api/v1/warehouses')).status).toBe(404);
    expect((await fetch(origin + '/health/live', { method: 'POST' })).status).toBe(405);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
