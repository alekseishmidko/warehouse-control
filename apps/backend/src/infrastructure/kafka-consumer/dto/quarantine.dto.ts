/** @file Внутренний адрес durable записи: Kafka offset — decimal int64 string, не number и не aggregate version. */
export type KafkaAddress = {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
};
/** Безопасный snapshot без key/value/headers/ciphertext. id связывает административный audit. */
export type QuarantineSnapshot = KafkaAddress & {
  id: string;
  status: 'retry' | 'quarantine' | 'resolved';
  attempts: number;
  retry_base: number;
  error_code: string;
  digest: string;
  raw_bytes: number;
  ready: boolean;
  event_id: string | null;
};
/** Команда оператора: личность задаётся trusted local admin context, не Kafka record. */
export interface KafkaRecoveryCommand {
  id: string;
  operatorId: string;
  correlationId: string;
  reasonCode: string;
}
