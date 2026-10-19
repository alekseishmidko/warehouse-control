/** @file Общие внутренние метаданные мутации: доверенный субъект, корреляция и код основания. */
/** Не HTTP body: заполнение actor из auth/system context — ответственность вызывающего сервиса. */
export interface OperationMetadata {
  readonly actorType: 'user' | 'system';
  readonly actorId: string;
  readonly correlationId: string;
  readonly reasonCode: string;
}
