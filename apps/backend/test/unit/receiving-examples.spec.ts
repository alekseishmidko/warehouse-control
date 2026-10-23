/** @file Проверка собственных HTTP примеров реальным DTO validator и согласованности с event fixture; без Docker. */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReceiptDto } from '@backend/modules/receiving/dto/receipt.dto';
import { EventContracts } from '@backend/shared/events/services/event-contracts';

/** Загружает только публичный синтетический fixture из docs, не читает .env или рабочую БД. */
function example(name: string) { return JSON.parse(readFileSync(resolve('../../docs/contracts/examples', name), 'utf8')); }
test('saved create request validates through actual HTTP DTO including nested lines', async () => {
  const input = plainToInstance(CreateReceiptDto, example('receipt-create.request.json'));
  expect(await validate(input, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true })).toEqual([]);
});
test('saved posted response describes exactly the same receipt/lines as ReceivingPosted contract example', () => {
  const response = example('receipt-posted.response.json'); const input = example('receipt-create.request.json');
  const event = new EventContracts().parseForHandler(JSON.stringify(example('receiving.receipt-posted.v1.json')));
  expect(response).toMatchObject({ ...input, status: 'posted', id: event.aggregateId, postedEventId: event.eventId, postedAt: event.occurredAt });
  expect(response.lines.map((line: { id: string; productId: string; quantity: number }) => ({ receiptLineId: line.id, productId: line.productId, quantity: line.quantity }))).toEqual(event.payload.lines);
});
