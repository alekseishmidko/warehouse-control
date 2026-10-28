/** @file Локальные unit-контракты восстановления: строгие флаги, явное разрешение
 * и фильтрация key-value диагностики. PostgreSQL/Docker здесь не требуются. */
import { randomUUID } from 'node:crypto';
import { parseRecoveryOptions, requireLocalRecovery, validateRetry } from '@backend/infrastructure/outbox/recovery-options';
import { validateEnvironment } from '@backend/infrastructure/config/environment';
import { deliveryDiagnostic, safeDeliveryError } from '@backend/shared/diagnostics/delivery-diagnostic';
import { logDelivery } from '@backend/infrastructure/worker/delivery-logger';
import { WorkerLoop } from '@backend/infrastructure/worker/services/worker-loop';
import type { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
import { validateWorkerEnvironment } from '@backend/infrastructure/worker/worker.config';
const id = randomUUID(); const correlation = randomUUID();
/** Успешный разбор нормализует UUID, добавляет server correlation и документированные пороги. */
test('strict CLI parses inspect, retry operator/reason and signal thresholds', () => {
  expect(parseRecoveryOptions(['inspect', '--event', id.toUpperCase(), '--consumer', 'inventory.putaway', '--payload'], correlation))
    .toMatchObject({ command: 'inspect', address: { eventId: id }, payload: true });
  expect(parseRecoveryOptions(['retry', '--event', id, '--consumer', 'inventory.putaway', '--operator', id, '--reason', 'dependency-restored'], correlation))
    .toMatchObject({ command: 'retry', input: { operatorId: id, reasonCode: 'dependency-restored', correlationId: correlation } });
  expect(parseRecoveryOptions(['signal'], correlation)).toMatchObject({ thresholds: { deadLimit: 1, backlogLimit: 100, maxAgeSeconds: 60 } });
});
/** Неизвестный/повторный флаг, неполная команда или неверный порог отклоняются до БД. */
test.each([
  [], ['inspect'], ['retry', '--event', id, '--consumer', 'inventory.putaway'], ['inspect', '--event', id, '--consumer', 'bad'],
  ['inspect', '--event', id, '--event', id], ['inspect', '--event', id, '--consumer', 'inventory.putaway', '--raw'],
  ['signal', '--dead-limit', '0'], ['signal', '--backlog-limit', 'NaN'], ['signal', '--payload'], ['signal', '--max-age-seconds', '9999999999'],
].map(args => [args as string[]]))('invalid args %j do not reach DB', args => { expect(() => parseRecoveryOptions(args, correlation)).toThrow(); });
/** Причина — ограниченный технический код; свободный текст и credentials не отражаются в отказе. */
test.each(['', 'free form incident text', 'TOKEN=secret', 'a'.repeat(97)])('invalid reason %j is rejected without reflecting value', reasonCode => {
  expect(() => validateRetry({ eventId: id, consumer: 'inventory.putaway', operatorId: id, correlationId: correlation, reasonCode })).toThrow('INVALID_ARGUMENTS');
});
/** NODE_ENV по умолчанию не даёт разрешения: и dev/test, и opt-in должны быть явными. */
test.each([
  { NODE_ENV: 'production', OUTBOX_ADMIN_ENABLED: 'true' }, { NODE_ENV: 'test' }, { OUTBOX_ADMIN_ENABLED: 'true' },
])('local guard requires explicit dev/test and opt-in %j', env => {
  const config = validateEnvironment({ DATABASE_URL: 'postgresql://offline@127.0.0.1/db' });
  expect(() => requireLocalRecovery(config, env)).toThrow('LOCAL_ACCESS_REQUIRED');
});
/** Проверяем hostname guard; успешный loopback не подтверждает личность оператора. */
test('remote DB is denied, loopback authorized; this does not authenticate an operator directory', () => {
  const env = { NODE_ENV: 'test', OUTBOX_ADMIN_ENABLED: 'true' };
  expect(() => requireLocalRecovery(validateEnvironment({ DATABASE_URL: 'postgresql://offline@db.example/db' }), env)).toThrow();
  expect(() => requireLocalRecovery(validateEnvironment({ DATABASE_URL: 'postgresql://offline@localhost/db' }), env)).not.toThrow();
});
/** Проверяем разрешённые поля, маскирование и best-effort sink: сломанный stdout не меняет outcome. */
test('diagnostic selects key-value fields, omits token/unknown properties and masks arbitrary errors/correlation', () => {
  const diagnostic = deliveryDiagnostic({ eventId: id, aggregateType: 'receipt', aggregateId: id, version: 1,
    destination: 'inventory.putaway', attempt: 2, correlationId: 'secret', lastError: 'password=secret' });
  expect(diagnostic).toEqual({ eventId: id, correlationId: null, stream: { aggregateType: 'receipt', aggregateId: id, version: 1 },
    consumer: 'inventory.putaway', attempt: 2, lastError: 'REDACTED' });
  expect(safeDeliveryError('DATABASE_REJECTED')).toBe('DATABASE_REJECTED'); expect(safeDeliveryError(null)).toBeNull();
  const sink = jest.spyOn(console, 'info').mockImplementation(() => {}); logDelivery('dead', diagnostic);
  expect(JSON.parse(sink.mock.calls[0][0])).toEqual({ event: 'worker.delivery', status: 'dead', ...diagnostic });
  sink.mockImplementation(() => { throw new Error('closed stdout'); }); expect(() => logDelivery('dead', diagnostic)).not.toThrow();
  sink.mockRestore();
});

/** Promise обработки отклоняется с чувствительным cause; loop выводит только безопасный
 * код и контекст соответствующего claim, после stop дожидается завершения batch. */
test('failed persistence retains per-claim diagnostic context without raw cause; stop still drains poll', async () => {
  const claim = { eventId: id, correlationId: correlation, aggregateType: 'receipt', aggregateId: id, version: 1,
    destination: 'inventory.putaway', token: randomUUID(), attempt: 4, lastError: null };
  const worker = { claim: jest.fn().mockResolvedValue([claim]), process: jest.fn().mockRejectedValue(new Error('password=secret')) };
  const loop = new WorkerLoop(worker as unknown as WorkerService, validateWorkerEnvironment({}));
  // Тестовый барьер: вывод диагностики синхронно вызывает stop, запрещая следующий claim.
  // Имитируем отказ сохранения результата, а не бизнес-эффект; raw cause не должен попасть в лог.
  const sink = jest.spyOn(console, 'info').mockImplementation(() => { loop.stop(); });
  try {
    await loop.run(); const record = JSON.parse(sink.mock.calls[0][0]);
    expect(record).toMatchObject({ status: 'persistence-failed', eventId: id, correlationId: correlation, attempt: 4,
      consumer: 'inventory.putaway', lastError: 'TRANSIENT_FAILURE' });
    expect(JSON.stringify(record)).not.toContain('secret'); expect(record).not.toHaveProperty('token');
    expect(worker.claim).toHaveBeenCalledTimes(1);
  } finally { loop.stop(); sink.mockRestore(); }
});
