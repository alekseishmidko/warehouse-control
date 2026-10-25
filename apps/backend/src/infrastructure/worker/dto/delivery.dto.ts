/** @file Внутренние worker contracts: immutable claim identity и DB-only handler с opaque transaction context. */
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
/** Серверный результат claim, не клиентский DTO; token нельзя менять/переиспользовать для нового claim. */
export interface DeliveryClaim {
  readonly eventId: string; readonly destination: string; readonly aggregateType: string;
  readonly aggregateId: string; readonly version: number; readonly token: string;
}
/**
 * Stable consumerName = destination; полный поток агрегата, включая явные no-op будущих типов.
 * handle получает проверенный event/context, должен await все DB-операции через сервисы владельцев.
 * Эффекты вне PostgreSQL, fire-and-forget, nested run и swallowing ошибок запрещены.
 * Ошибка откатывает эффект/marker/cursors; permanent бизнес-отказ обозначать PermanentDeliveryError.
 */
export interface LocalEventHandler {
  readonly destination: string;
  handle(context: TransactionContext, event: KnownEvent): Promise<void>;
}
