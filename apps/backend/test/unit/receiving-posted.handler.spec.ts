/** @file Dispatch/metadata unit contract; реальный task/marker effect и неизвестные schema проверяются integration. */
import { ReceivingPostedHandler, PUTAWAY_SYSTEM_ACTOR_ID } from '@backend/infrastructure/worker/services/receiving-posted.handler';
import { PutawayInputError } from '@backend/modules/inventory/services/putaway.service';
import type { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import type { TransactionContext } from '@backend/shared/transactions/transaction.port';
import type { KnownEvent } from '@backend/shared/events/dto/event.dto';
import { outboxFixture } from '../support/outbox.fixture';
const context = {} as TransactionContext;
/** Только валидный синтетический fact; runtime EventContracts и SQL не подменяются этими unit assertions. */
function event(): KnownEvent { return { ...outboxFixture(), eventId: '78ae6ebd-16c3-4cb8-896b-de321cb8c634', aggregateVersion: 1 } as KnownEvent; }
test('dispatch passes same context and server actor, never calls stock receive', async () => {
  const createPutawayTasks = jest.fn().mockResolvedValue([]); const receive = jest.fn();
  const handler = new ReceivingPostedHandler({ createPutawayTasks, receive } as unknown as InventoryService);
  const fact = event(); await handler.handle(context, fact);
  expect(createPutawayTasks).toHaveBeenCalledWith(context, { event: fact, actorType: 'system', actorId: PUTAWAY_SYSTEM_ACTOR_ID,
    correlationId: fact.correlationId, reasonCode: 'receipt-posted' });
  expect(receive).not.toHaveBeenCalled(); expect(handler.destination).toBe('inventory.putaway');
});
test('future known uninteresting type is a no-op only after upstream validation', async () => {
  const createPutawayTasks = jest.fn(); const handler = new ReceivingPostedHandler({ createPutawayTasks } as unknown as InventoryService);
  // Тестируем только будущую routing ветку adapter. Этот surrogate НЕ зарегистрирован
  // в EventContracts и не становится допустимым production event из-за TypeScript cast.
  await handler.handle(context, { ...event(), type: 'receipt.future-known-fact' } as unknown as KnownEvent);
  expect(createPutawayTasks).not.toHaveBeenCalled();
});
test('semantic failure becomes permanent; database errors retain their cause/classification', async () => {
  const createPutawayTasks = jest.fn().mockRejectedValue(new PutawayInputError());
  const handler = new ReceivingPostedHandler({ createPutawayTasks } as unknown as InventoryService);
  await expect(handler.handle(context, event())).rejects.toMatchObject({ code: 'HANDLER_REJECTED' });
  const failure = new Error('Database temporarily unavailable'); createPutawayTasks.mockRejectedValue(failure);
  await expect(handler.handle(context, event())).rejects.toBe(failure);
});
