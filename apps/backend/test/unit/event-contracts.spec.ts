/** @file Контрактные fixtures и негативные границы WMS-105; обе runtime границы без Docker/DB. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventContracts } from '@backend/shared/events/services/event-contracts';
import { EventContractError, EventContractErrorCode } from '@backend/shared/events/event-contract.error';
import { EVENT_REGISTRY, MAX_EVENT_BYTES, MAX_RECEIPT_LINES } from '@backend/shared/events/event-registry';
import { eventSchemas } from '@backend/shared/events/generated/event-schemas';
import { MAX_STOCK_QUANTITY } from '@backend/shared/quantities/quantity';

const contracts = new EventContracts();
// Каждый вызов читает новый объект: мутации негативного сценария не влияют на соседние tests.
const example = () => JSON.parse(readFileSync(resolve('../../docs/contracts/examples/receiving.receipt-posted.v1.json'), 'utf8'));
// Полные fixtures фиксируют ожидаемую совместимость версии, а не только отдельное поле.
const fixture = (name: string) => JSON.parse(readFileSync(resolve(`../../docs/contracts/fixtures/receiving.${name}.json`), 'utf8'));

test('every source schema is explicitly registered at its exact type/version', () => {
  // Генерация новой schema без регистрации должна ломать проверку, а не терять поддержку молча.
  const expected = Object.values(eventSchemas).map(schema => `${schema.properties.type.const}:${schema.properties.schemaVersion.const}`);
  expect(Object.keys(EVENT_REGISTRY).sort()).toEqual(expected.sort());
});

/** Проверяет один и тот же отказ на producer и consumer; production callbacks/SQL здесь не имитируются. */
function expectRejected(input: unknown, code: EventContractErrorCode = 'INVALID_EVENT') {
  // Один input проходит через реальные producer/consumer entrypoints: политики отказа совпадают.
  for (const action of [() => contracts.prepareForOutbox(input), () => contracts.parseForHandler(JSON.stringify(input))]) {
    expect(action).toThrow(expect.objectContaining({ name: 'EventContractError', code }));
  }
}

test('existing ReceivingPosted example round-trips; producer returns a validated independent snapshot', () => {
  const input = example();
  const prepared = contracts.prepareForOutbox(input);
  expect(prepared.event).toEqual(input);
  // Порча исходного объекта после подготовки не должна испортить уже проверенное сообщение.
  input.payload.lines[0].quantity = 0;
  expect(prepared.event.payload.lines[0].quantity).toBe(10);
  expect(contracts.parseForHandler(prepared.message)).toEqual(prepared.event);
});

test('unknown optional fields at envelope, payload and line survive both boundaries', () => {
  const input = fixture('optional-fields');
  expect(contracts.prepareForOutbox(input).event).toEqual(input);
  expect(contracts.parseForHandler(JSON.stringify(input))).toEqual(input);
});

test('separate fixtures reject unknown version and incorrect payload', () => {
  expectRejected(fixture('unknown-version'), 'UNSUPPORTED_EVENT');
  expectRejected(fixture('invalid-payload'));
});

test.each(['other.event', '__proto__', 'constructor'])('unknown type %s cannot select a registry member', type => {
  expectRejected({ ...example(), type }, 'UNSUPPORTED_EVENT');
});

test.each([null, [], true, 1, 'event'])('rejects non-object envelope %j', input => expectRejected(input));

test.each(['1', 0, -1, 1.5, null])('rejects malformed schemaVersion %j', schemaVersion => {
  expectRejected({ ...example(), schemaVersion });
});

test.each(['eventId', 'type', 'schemaVersion', 'aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', 'correlationId', 'payload'])
('requires envelope field %s', field => {
  // Удаляем ровно одно обязательное поле из валидного сообщения, изолируя причину отказа.
  const input = example();
  delete input[field];
  expectRejected(input);
});

test.each(['receiptId', 'warehouseId', 'receivingLocationId', 'lines'])('requires payload field %s', field => {
  const input = example();
  delete input.payload[field];
  expectRejected(input);
});

test.each(['receiptLineId', 'productId', 'quantity'])('requires line field %s', field => {
  const input = example();
  delete input.payload.lines[0][field];
  expectRejected(input);
});

test.each(['eventId', 'aggregateId', 'correlationId', 'causationId'])('checks envelope UUID %s', field => {
  expectRejected({ ...example(), [field]: 'private-invalid-uuid' });
});

test.each(['receiptId', 'warehouseId', 'receivingLocationId'])('checks payload UUID %s', field => {
  const input = example();
  input.payload[field] = 'invalid';
  expectRejected(input);
});

test.each(['receiptLineId', 'productId'])('checks line UUID %s', field => {
  const input = example();
  input.payload.lines[0][field] = 'invalid';
  expectRejected(input);
});

test.each(['2026-10-17T06:00:00+00:00', '2026-10-17T09:00:00+03:00', '2026-10-17T06:00:00', '2026-02-30T06:00:00Z', 'yesterday'])
('requires real UTC Z timestamp %s', occurredAt => expectRejected({ ...example(), occurredAt }));

test.each([0, -1, 0.5, MAX_STOCK_QUANTITY + 1, '10', null])('rejects line quantity %j without coercion', quantity => {
  const input = example();
  input.payload.lines[0].quantity = quantity;
  expectRejected(input);
});

test.each([1, MAX_STOCK_QUANTITY])('allows int4 quantity boundary %s', quantity => {
  const input = example();
  input.payload.lines[0].quantity = quantity;
  expect(contracts.prepareForOutbox(input).event.payload.lines[0].quantity).toBe(quantity);
});

test('line limits match generated DTO contract: 1..1000, unknown fields still size-bounded', () => {
  const input = example();
  const line = input.payload.lines[0];
  expect(MAX_RECEIPT_LINES).toBe(1000);
  // Повтор line IDs допустим для schema: уникальность строк проверит будущий receiving service.
  // Здесь проверяем только размер массива, не семантику документа.
  input.payload.lines = Array.from({ length: MAX_RECEIPT_LINES }, () => ({ ...line }));
  expect(contracts.prepareForOutbox(input).event.payload.lines).toHaveLength(MAX_RECEIPT_LINES);
  input.payload.lines.push(line);
  expectRejected(input);
  input.payload.lines = [];
  expectRejected(input);
});

test('byte limit includes UTF-8 optional fields, accepts exact maximum and rejects maximum+1', () => {
  // Кириллическая буква занимает несколько bytes: string.length дал бы неверную границу.
  const input = { ...example(), future: 'я' };
  // ASCII padding доводит уже сериализованный JSON до точного лимита, включая кавычки/ключи.
  const padding = MAX_EVENT_BYTES - Buffer.byteLength(JSON.stringify(input), 'utf8');
  input.future += 'a'.repeat(padding);
  const wire = JSON.stringify(input);
  expect(Buffer.byteLength(wire, 'utf8')).toBe(MAX_EVENT_BYTES);
  expect(contracts.parseForHandler(wire)).toEqual(input);
  expect(contracts.prepareForOutbox(input).message).toBe(wire);
  input.future += 'a';
  expectRejected(input, 'MESSAGE_TOO_LARGE');
  // Oversized malformed JSON должен отклоняться по размеру ещё до попытки parse.
  expect(() => contracts.parseForHandler(' '.repeat(MAX_EVENT_BYTES + 1))).toThrow(expect.objectContaining({ code: 'MESSAGE_TOO_LARGE' }));
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects aggregateVersion %s', aggregateVersion => {
  expectRejected({ ...example(), aggregateVersion });
});

test('valid optional metadata and aggregateVersion maximum; traceparent length is bounded, not OTel-parsed', () => {
  const input = { ...example(), aggregateVersion: Number.MAX_SAFE_INTEGER,
    causationId: example().eventId, traceparent: 'a'.repeat(512) };
  expect(contracts.prepareForOutbox(input).event).toEqual(input);
  input.traceparent += 'a';
  expectRejected(input);
});

test('malformed JSON and non-JSON producer input fail safely without payload in error', () => {
  // Вход специально содержит маркер секрета: диагностическая ошибка не должна его повторять.
  expect(() => contracts.parseForHandler('{"secret":"private-value"')).toThrow(new EventContractError('INVALID_JSON'));
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const input of [undefined, circular, { ...example(), future: BigInt(1) }, { ...example(), future: Infinity }]) {
    expect(() => contracts.prepareForOutbox(input)).toThrow(new EventContractError('INVALID_JSON'));
  }
  try { contracts.prepareForOutbox({ ...example(), eventId: 'private-value' }); }
  catch (error) { expect(String(error)).not.toContain('private-value'); }
});
