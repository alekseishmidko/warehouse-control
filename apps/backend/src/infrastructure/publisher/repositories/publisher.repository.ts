/** @file Outbox transport persistence на одной dedicated pg session; session advisory lock не возвращается в pool. */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PublisherRecord, PublisherFailureCode } from '../dto/publisher-record.dto';
/** Максимум persisted попыток transport; последний unknown outcome блокирует stream как dead. */
export const PUBLISHER_MAX_ATTEMPTS = 10;
/** Внутренний SQL row, не публичный DTO: bigint намеренно остаётся text до формирования snapshot. */
interface CandidateEvent {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  version: string;
  envelope: unknown;
  attempts: number;
}
/** Только kafka.publish rows; consumer_streams/processed_events и business tables не меняются. */
export class PublisherRepository {
  private constructor(private readonly client: PoolClient) {}
  /** Получает единственного владельца до подключения Kafka, затем проверяет сохранённую историю.
   * Эта pg session не переподключается: старый процесс не сможет завершить delivery через другой socket.
   */
  static async acquire(pool: Pool): Promise<PublisherRepository> {
    const client = await pool.connect();
    try {
      await client.query("set statement_timeout='5000'");
      // Ключ стабилен между релизами: revision/Pod UID разрешили бы двум процессам получить разные locks.
      const lock = await client.query<{ owned: boolean }>(
        'select pg_try_advisory_lock(1464685363,503) as owned',
      );
      if (!lock.rows[0].owned) throw new Error('Publisher singleton already owned');
      const repository = new PublisherRepository(client);
      await repository.assertRetainedHistory();
      return repository;
    } catch (error) {
      client.release(true);
      throw error;
    }
  }
  /** Unique index запрещает повтор версии; min1 и max/count=N исключают разрыв последовательности.
   * Проверка вне бизнес-транзакции: при расхождении нельзя угадывать начальную позицию consumer.
   */
  // COUNT=N, MIN=1 и MAX=N вместе с unique index исключают пропущенные версии.
  // Полный replay начинается с1; произвольную boundary здесь выбирать нельзя.
  private async assertRetainedHistory(): Promise<void> {
    const gaps = await this.client.query(`
      select s.aggregate_id
      from outbox_aggregate_sequences s
      left join outbox_events e
        on e.aggregate_type=s.aggregate_type and e.aggregate_id=s.aggregate_id
      group by s.aggregate_type,s.aggregate_id,s.last_version
      having count(e.event_id)<>s.last_version
        or min(e.aggregate_version)<>1 or max(e.aggregate_version)<>s.last_version
      limit 1`);
    if (gaps.rowCount) throw new Error('Publisher requires complete retained history');
  }
  /** Короткие SQL-only transactions; никакого transport I/O внутри callback. */
  private async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const result = await work();
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
  /** Выбирает только cursor+1; retry/dead не пропускаются, другие aggregates остаются доступны.
   * Registration ленивый: writer не импортирует Kafka и не зависит от доступности broker.
   */
  async next(): Promise<PublisherRecord | null> {
    return this.transaction(async () => {
      const row = await this.findNextEvent();
      if (!row) return null;
      // Token идентифицирует именно попытку. После claim commit процесс может упасть;
      // новый владелец повторит тот же eventId, но получит другой token и increment attempts.
      const token = randomUUID();
      await this.persistAttempt(row, token);
      return {
        eventId: row.event_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        version: Number(row.version),
        envelope: row.envelope,
        token,
        attempt: row.attempts + 1,
      };
    });
  }
  /** Session lock исключает конкурирующие claims, поэтому SELECT не требует SKIP LOCKED.
   * Статус processing можно восстановить до expiry lease: старый владелец уже потерял session lock.
   * Условие cursor+1 и фильтр status запрещают обход retry/dead предыдущей версии.
   */
  private async findNextEvent(): Promise<CandidateEvent | undefined> {
    const result = await this.client.query<CandidateEvent>(`
      select e.event_id,e.aggregate_type,e.aggregate_id,
        e.aggregate_version::text as version,e.envelope,coalesce(d.attempts,0) as attempts
      from outbox_events e
      left join delivery_streams s
        on s.destination='kafka.publish' and s.aggregate_type=e.aggregate_type and s.aggregate_id=e.aggregate_id
      left join outbox_deliveries d
        on d.event_id=e.event_id and d.destination='kafka.publish'
      where e.aggregate_version=coalesce(s.last_completed_version,0)+1
        and (d.event_id is null or (
          d.status in ('pending','retry','processing') and d.available_at<=clock_timestamp()
        ))
      order by e.created_at,e.aggregate_id
      limit 1`);
    return result.rows[0];
  }
  /** Регистрация и token обеих строк входят в один claim commit; network I/O начинается после него.
   * Ленивый INSERT сохраняет независимость бизнес-writer от нового transport destination.
   */
  private async persistAttempt(row: CandidateEvent, token: string): Promise<void> {
    await this.client.query(
      "insert into delivery_streams(destination,aggregate_type,aggregate_id) values('kafka.publish',$1,$2) on conflict do nothing",
      [row.aggregate_type, row.aggregate_id],
    );
    await this.client.query(
      "insert into outbox_deliveries(event_id,destination) values($1,'kafka.publish') on conflict do nothing",
      [row.event_id],
    );
    await this.client.query(
      `update outbox_deliveries
         set status='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds'
         where event_id=$1 and destination='kafka.publish'`,
      [row.event_id, token],
    );
    // Lease-поля описывают попытку. Их expiry не разрешает запуск второго singleton.
    await this.client.query(
      `update delivery_streams
         set lease_token=$3,lease_until=clock_timestamp()+interval '45 seconds'
         where destination='kafka.publish' and aggregate_type=$1 and aggregate_id=$2`,
      [row.aggregate_type, row.aggregate_id, token],
    );
  }
  /** Завершает только собственную попытку; cursor и delivery атомарны после broker ack. */
  // Вызывает только service после Kafka commit ack. Crash между двумя commit даёт duplicate,
  // поэтому consumer effect/marker должны быть атомарны; transport сам marker не создаёт.
  async complete(record: PublisherRecord): Promise<void> {
    await this.transaction(async () => {
      const delivery = await this.client.query(
        `update outbox_deliveries
         set status='completed',completed_at=clock_timestamp(),last_error=null,lease_token=null,lease_until=null
         where destination='kafka.publish' and event_id=$1 and lease_token=$2
         returning event_id`,
        [record.eventId, record.token],
      );
      const stream = await this.client.query(
        `update delivery_streams
         set last_completed_version=$3,lease_token=null,lease_until=null
         where destination='kafka.publish' and aggregate_type=$1 and aggregate_id=$2 and last_completed_version=$3-1 and lease_token=$4
         returning aggregate_id`,
        [record.aggregateType, record.aggregateId, record.version, record.token],
      );
      // Оба изменения обязательны: stale token/cursor откатывает всю SQL transaction,
      // иначе delivery могла бы стать completed без корректного продвижения своего stream.
      if (delivery.rowCount !== 1 || stream.rowCount !== 1)
        throw new Error('Stale publisher completion');
    });
  }
  /** При unknown ack cursor не движется. Ограниченный бюджет; dead stream требует отдельной operator recovery. */
  async fail(record: PublisherRecord, code: PublisherFailureCode): Promise<void> {
    await this.transaction(async () => {
      const delivery = await this.client.query(
        `update outbox_deliveries
         set status=$3,last_error=$4,available_at=clock_timestamp()+interval '1 second',lease_token=null,lease_until=null
         where destination='kafka.publish' and event_id=$1 and lease_token=$2
         returning event_id`,
        [
          record.eventId,
          record.token,
          code !== 'TRANSIENT_FAILURE' || record.attempt >= PUBLISHER_MAX_ATTEMPTS
            ? 'dead'
            : 'retry',
          code,
        ],
      );
      const stream = await this.client.query(
        `update delivery_streams
         set lease_token=null,lease_until=null
         where destination='kafka.publish' and aggregate_type=$1 and aggregate_id=$2 and lease_token=$3
         returning aggregate_id`,
        [record.aggregateType, record.aggregateId, record.token],
      );
      // Оба изменения обязательны: stale token/cursor откатывает всю SQL transaction,
      // иначе delivery могла бы стать completed без корректного продвижения своего stream.
      if (delivery.rowCount !== 1 || stream.rowCount !== 1)
        throw new Error('Stale publisher failure');
    });
  }
  /** Readiness не подтверждает broker effects; проверяет owner socket. */
  async assertReady(): Promise<void> {
    await this.client.query('select 1');
  }
  /** Destroy, не release в pool: advisory lock не должен пережить process owner. */
  close(): void {
    this.client.release(true);
  }
}
