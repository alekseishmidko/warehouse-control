/** @file Порядок transport publish; бизнес-writer сохраняет факт независимо от Kafka.
 * Поток данных:
 *   API → PG: business + audit + outbox COMMIT
 *   Publisher → PG: claim/token COMMIT → schema/identity check
 *   Publisher → Kafka: send + transaction commit ack
 *   Publisher → PG: completed + cursor COMMIT
 * Между последними commit возможен crash: Kafka уже содержит A, PG ещё не подтвердил A.
 * Новый owner повторяет A с прежним eventId; consumer обязан выполнить dedup, не второй бизнес-эффект.
 */
import type { EventTransport } from '../../../shared/transport/event-transport.port';
import { EventContractError } from '../../../shared/events/event-contract.error';
import { EventContracts } from '../../../shared/events/services/event-contracts';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
import type { PublisherRecord } from '../dto/publisher-record.dto';
import { PublisherRepository, PUBLISHER_MAX_ATTEMPTS } from '../repositories/publisher.repository';
import { logEvent, logScope } from '../../logging/runtime-logger';
/** Process владеет одним экземпляром и не вызывает tick параллельно. */
export class PublisherService {
  private readonly contracts = new EventContracts();
  constructor(
    private readonly repository: PublisherRepository,
    private readonly transport: EventTransport,
  ) {}
  /** Возвращает idle без I/O broker, completed после commit. Любая uncertain публикация останавливает процесс. */
  async tick(): Promise<'idle' | 'completed' | 'dead'> {
    const record = await this.repository.next();
    if (!record) return 'idle';
    return logScope(
      {
        module: 'outbox',
        eventId: record.eventId,
        aggregateId: record.aggregateId,
        destination: 'kafka.publish',
        attempt: record.attempt,
      },
      async () => {
        let event;
        try {
          event = this.validateRecord(record);
        } catch (error) {
          const errorCode = error instanceof EventContractError ? error.code : 'IDENTITY_MISMATCH';
          await this.repository.fail(record, errorCode);
          logEvent('delivery.dead', { errorCode });
          return 'dead';
        }
        if (record.attempt > PUBLISHER_MAX_ATTEMPTS) {
          await this.repository.fail(record, 'ATTEMPTS_EXHAUSTED');
          logEvent('delivery.dead', { errorCode: 'ATTEMPTS_EXHAUSTED' });
          return 'dead';
        }
        return logScope({ correlationId: event.correlationId }, () =>
          this.publishAndComplete(record, event),
        );
      },
    );
  }
  /** PostgreSQL нормализует UUID в lowercase, envelope может сохранять исходный регистр.
   * Номер версии и SQL identity проверяются до transport; неизвестные optional поля не удаляются.
   */
  private validateRecord(record: PublisherRecord): KnownEvent {
    const event = this.contracts.parseForHandler(JSON.stringify(record.envelope));
    if (
      event.eventId.toLowerCase() !== record.eventId ||
      event.aggregateId.toLowerCase() !== record.aggregateId ||
      event.aggregateType !== record.aggregateType ||
      event.aggregateVersion !== record.version
    )
      throw new Error('Identity mismatch');
    return event;
  }
  /** Success публикуется после двух подтверждений; DB ошибка не маскируется под network retry. */
  private async publishAndComplete(
    record: PublisherRecord,
    event: KnownEvent,
  ): Promise<'completed'> {
    // Claim уже закоммичен. Здесь не открыт SQL transaction: broker outage не удерживает
    // блокировки бизнес-операций. Business writer вообще не вызывает этот transport.
    try {
      await this.transport.publish(event);
    } catch {
      // Broker мог сохранить событие, даже если клиент не получил ack. Cursor не двигаем,
      // сохраняем retry/dead и завершаем process: следующая попытка использует прежний eventId.
      await this.repository.fail(
        record,
        record.attempt >= PUBLISHER_MAX_ATTEMPTS ? 'ATTEMPTS_EXHAUSTED' : 'TRANSIENT_FAILURE',
      );
      logEvent(record.attempt >= PUBLISHER_MAX_ATTEMPTS ? 'delivery.dead' : 'delivery.retry', {
        errorCode: 'KAFKA_UNCONFIRMED',
      });
      throw new Error('Publisher transport outcome uncertain');
    }
    // Намеренно вне catch publish: commit ack loss не превращается в retry через другой DB socket.
    await this.repository.complete(record);
    logEvent('delivery.completed');
    return 'completed';
  }
}
