/** @file Snapshot persisted попытки и безопасные причины отказа; DTO не содержит pg client и не выполняет I/O. */
import type { EventContractErrorCode } from '../../../shared/events/event-contract.error';
/** Коды состояния delivery: raw exception не сохраняется в operational metadata. */
export type PublisherFailureCode =
  EventContractErrorCode | 'IDENTITY_MISMATCH' | 'ATTEMPTS_EXHAUSTED' | 'TRANSIENT_FAILURE';
/** SQL identity отделена от envelope: service сравнивает их до сетевой отправки. */
export interface PublisherRecord {
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Положительный JS safe integer; repository читает SQL bigint через text без округления. */
  readonly version: number;
  /** До schema/identity validation данные БД остаются unknown, а не KnownEvent. */
  readonly envelope: unknown;
  /** Случайный token текущей persisted попытки; только он разрешает completion/failure. */
  readonly token: string;
  /** Общее число начатых попыток, включая crash; process restart не сбрасывает бюджет. */
  readonly attempt: number;
}
