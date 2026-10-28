/** @file SQL административных операций outbox: чтение, блокировки NOWAIT и планирование retry с историей.
 * Не пишет складские таблицы; все методы используют переданную транзакцию, commit выполняет сервис. */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { transactionClient } from '../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { DeliveryAddress, RetryDeliveryDto } from '../dto/recovery.dto';
import { outboxRecoveryActions } from '../outbox.schema';
/** Внутренний результат SQL, а не публичный ответ CLI. envelope/last_error недоверенные
 * и требуют фильтрации; bigint версии/курсоры возвращаются строками и преобразуются сервисом. */
export interface RecoverySnapshot extends Record<string, unknown> {
  event_id: string; destination: string; aggregate_type: string; aggregate_id: string; version: string; envelope: unknown;
  status: string; attempts: number; retry_attempt_base: number; last_error: unknown; available_at: string; completed_at: string | null;
  lease_until: string | null; stream_lease_until: string | null; lease_active: boolean; stream_active: boolean;
  cursor: string; consumer_cursor: string; processed: boolean;
}
/** Закрытый SQL-provider модуля outbox. Требует действующий TransactionContext;
 * не создаёт транзакцию, не подтверждает запись и не подавляет ошибки драйвера. */
@Injectable()
export class RecoveryRepository {
  /** Проверяет членство current_user в warehouse_outbox_admin, включая SET LOCAL ROLE в тестах.
 * Возвращает boolean; локальный superuser проходит, но UUID оператора прав БД не даёт. */
  async isAdmin(context: TransactionContext): Promise<boolean> {
    const result = await transactionClient(context).execute<{ allowed: boolean }>(sql`select pg_has_role(current_user,'warehouse_outbox_admin','member') as allowed`);
    return result.rows[0].allowed;
  }
  /** Устанавливает локальные пределы statement_timeout и transaction_timeout по 5 секунд.
 * Настройки действуют только до конца переданной транзакции и не меняют API/worker соединения. */
  async bound(context: TransactionContext): Promise<void> {
    await transactionClient(context).execute(sql`select set_config('transaction_timeout','5000',true),set_config('statement_timeout','5000',true)`);
  }
  /** Читает адрес eventId+consumer одним SQL-запросом; отсутствие доставки возвращает null.
 * @param lock Для retry блокирует строки потока и доставки до конца транзакции. Для inspect блокировок нет.
 * @throws Ошибка PostgreSQL 55P03 при занятой строке: NOWAIT не ждёт активный handler.
 * Активность lease вычисляет clock_timestamp БД; локальные часы CLI не решают вопрос владения. */
  async read(context: TransactionContext, address: DeliveryAddress, lock = false): Promise<RecoverySnapshot | null> {
    const result = await transactionClient(context).execute<RecoverySnapshot>(sql`select e.event_id,e.aggregate_type,e.aggregate_id,
      e.aggregate_version::text as version,e.envelope,d.destination,d.status,d.attempts,d.retry_attempt_base,d.last_error,
      d.available_at,d.completed_at,d.lease_until,s.lease_until as stream_lease_until,
      coalesce(d.lease_until>clock_timestamp(),false) as lease_active,coalesce(s.lease_until>clock_timestamp(),false) as stream_active,
      s.last_completed_version::text as cursor,
      coalesce((select c.last_processed_version from consumer_streams c where c.consumer_name=d.destination
        and c.aggregate_type=e.aggregate_type and c.aggregate_id=e.aggregate_id),0)::text as consumer_cursor,
      exists(select 1 from processed_events p where p.consumer_name=d.destination and p.event_id=e.event_id) as processed
      from outbox_events e join outbox_deliveries d on d.event_id=e.event_id
      join delivery_streams s on s.destination=d.destination and s.aggregate_type=e.aggregate_type and s.aggregate_id=e.aggregate_id
      where e.event_id=${address.eventId} and d.destination=${address.consumer}
      ${lock ? sql`for update of s,d nowait` : sql``}`);
    return result.rows[0] ?? null;
  }
  /** Возвращает последние 20 вмешательств по адресу, новые первыми с устойчивым порядком по id.
 * Это ограничение вывода, а не retention: строки не удаляются. previous_error фильтрует сервис. */
  async history(context: TransactionContext, address: DeliveryAddress) {
    const result = await transactionClient(context).execute<{ id: string; operator_id: string; reason_code: string; correlation_id: string;
      previous_attempts: number; previous_retry_attempt_base: number; previous_error: unknown; audit_id: string; created_at: string }>(sql`
      select id,operator_id,reason_code,correlation_id,previous_attempts,previous_retry_attempt_base,previous_error,audit_id,created_at
      from outbox_recovery_actions where event_id=${address.eventId} and consumer=${address.consumer} order by created_at desc,id desc limit 20`);
    return result.rows;
  }
  /** Записывает историю и планирует dead → retry в заимствованной транзакции.
 * @param row Результат read(lock=true), прошедший проверки сервиса; блокировки ещё удерживаются.
 * @param auditId Идентификатор аудита, уже вставленного в той же транзакции.
 * @param previousError Только безопасный код после safeDeliveryError, не исходное исключение.
 * @returns UUID вставленной истории; до commit сервиса он ещё не подтверждает вмешательство.
 * @throws Ошибка SQL откатывает историю, аудит и оба UPDATE через runner вызывающего сервиса. */
  async schedule(context: TransactionContext, row: RecoverySnapshot, input: RetryDeliveryDto, auditId: string, previousError: string | null): Promise<string> {
    const tx = transactionClient(context);
    // Сначала сохраняем прежние attempts/base/error и связь с аудитом. При последующем сбое
    // запись также откатится: отдельного commit или внешнего I/O у репозитория нет.
    const [record] = await tx.insert(outboxRecoveryActions).values({ eventId: row.event_id, consumer: row.destination,
      operatorId: input.operatorId, reasonCode: input.reasonCode, correlationId: input.correlationId,
      previousAttempts: row.attempts, previousRetryAttemptBase: row.retry_attempt_base, previousError, auditId }).returning({ id: outboxRecoveryActions.id });
    // Общий attempts и last_error сохраняются; base=attempts открывает новый бюджет.
    // Токены снимаем только после проверок сервиса. Маркеры и оба курсора не меняем.
    await tx.execute(sql`update outbox_deliveries set status='retry',available_at=clock_timestamp(),lease_until=null,lease_token=null,
      retry_attempt_base=attempts where event_id=${row.event_id} and destination=${row.destination}`);
    await tx.execute(sql`update delivery_streams set lease_until=null,lease_token=null where destination=${row.destination}
      and aggregate_type=${row.aggregate_type} and aggregate_id=${row.aggregate_id}`);
    return record.id;
  }
  /** Считает локальное состояние одним SQL-запросом без payload и уведомлений.
 * backlog включает pending/retry/processing, но исключает dead; blockedStreams — потоки,
 * у которых именно следующая версия dead. Возраст считается от created_at события, а не available_at. */
  async signal(context: TransactionContext) {
    const result = await transactionClient(context).execute<{ dead: number; backlog: number; blockedStreams: number; expiredProcessing: number; oldestBacklogAgeSeconds: number }>(sql`
      select count(*) filter(where d.status='dead')::int as dead,
        count(*) filter(where d.status in ('pending','retry','processing'))::int as backlog,
        count(*) filter(where d.status='processing' and d.lease_until<=clock_timestamp())::int as "expiredProcessing",
        coalesce(greatest(0,extract(epoch from clock_timestamp()-min(e.created_at) filter(where d.status in ('pending','retry','processing')))),0)::float8 as "oldestBacklogAgeSeconds",
        (select count(*)::int from delivery_streams s join outbox_events x on x.aggregate_type=s.aggregate_type
          and x.aggregate_id=s.aggregate_id and x.aggregate_version=s.last_completed_version+1
          join outbox_deliveries y on y.event_id=x.event_id and y.destination=s.destination where y.status='dead') as "blockedStreams"
      from outbox_deliveries d join outbox_events e on e.event_id=d.event_id`);
    return result.rows[0];
  }
}
