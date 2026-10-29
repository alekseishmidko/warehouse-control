/** @file Владелец локальных inspect/retry/signal: проверяет роль БД и границы безопасности.
 * Retry фиксирует только планирование и аудит; обработчик выполняет отдельный worker после commit. */
import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  TransactionContext,
  TransactionRunner,
} from '../../../shared/transactions/transaction.port';
import {
  deliveryDiagnostic,
  safeDeliveryError,
} from '../../../shared/diagnostics/delivery-diagnostic';
import { EventContracts } from '../../../shared/events/services/event-contracts';
import { AuditService } from '../../../modules/audit/services/audit.service';
import { RecoveryRepository, RecoverySnapshot } from '../repositories/recovery.repository';
import {
  RecoveryError,
  DeliveryAddress,
  RetryDeliveryDto,
  BacklogThresholds,
} from '../dto/recovery.dto';
import { validateAddress, validateRetry, validateThresholds } from '../recovery-options';

/** Организует одну ограниченную транзакцию на команду. CLI отвечает за локальный допуск,
 * сервис — за права БД, состояние доставки, безопасную диагностику и атомарность вмешательства. */
@Injectable()
export class OutboxRecoveryService {
  private readonly contracts = new EventContracts();
  /** Получает runner, закрытый репозиторий и публичный AuditService. Чужие таблицы напрямую не пишет;
   * аудит использует тот же context, вложенный runner внутри сценария запрещён. */
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
    private readonly repository: RecoveryRepository,
    private readonly audit: AuditService,
  ) {}
  /** Читает безопасную диагностику без блокировки строк и без раскрытия токенов.
   * @param input Недоверенные UUID события и имя получателя, повторно валидируются сервисом.
   * @param includePayload Явное разрешение на ограниченный, проверенный preview; по умолчанию скрыт.
   * @returns Диагностику и последние 20 вмешательств после завершения read-транзакции.
   * @throws RecoveryError При неправильном адресе, отсутствии доставки или роли администратора.
   * Inspect и история читаются разными запросами: это наблюдение, не согласованный snapshot всей команды.
   * Retry перечитывает состояние под блокировками и не доверяет ранее показанному статусу. */
  async inspect(input: DeliveryAddress, includePayload = false) {
    const address = validateAddress(input);
    return this.transactions.run(async (context) => {
      await this.authorize(context);
      const row = await this.repository.read(context, address);
      if (!row) throw new RecoveryError('DELIVERY_NOT_FOUND');
      const history = await this.repository.history(context, address);
      return {
        ...this.describe(row),
        payload: this.payload(row.envelope, includePayload),
        recoveryHistory: history.map((action) => ({
          id: action.id,
          operatorId: action.operator_id,
          reasonCode: action.reason_code,
          correlationId: action.correlation_id,
          previousAttempts: action.previous_attempts,
          previousRetryAttemptBase: action.previous_retry_attempt_base,
          previousError: safeDeliveryError(action.previous_error),
          auditId: action.audit_id,
          createdAt: this.iso(action.created_at),
        })),
      };
    });
  }
  /**
   * Планирует повтор ровно одной dead-доставки после устранения причины отказа.
   * @param input Недоверенная команда с UUID оператора, технической причиной и UUID вмешательства.
   * @returns Подтверждённые UUID истории/аудита, идентичность события и прежний общий attempts.
   * Обработчик здесь не вызывается; готовность эффекта подтверждает последующая обработка worker.
   * @throws RecoveryError При занятой строке/lease, пропуске версии, обработанном событии, неверном статусе/правах.
   * Любой сбой SQL/аудита откатывает retry, историю и аудит вместе; исключение должно выйти из callback.
   */
  async retry(input: RetryDeliveryDto) {
    const command = Object.freeze(validateRetry(input));
    try {
      return await this.transactions.run(async (context) => {
        await this.authorize(context);
        const row = await this.repository.read(context, command, true);
        if (!row) throw new RecoveryError('DELIVERY_NOT_FOUND');
        // Блокировки NOWAIT уже получены, но live lease без удерживаемой SQL-блокировки
        // тоже принадлежит worker. После marker/cursor нельзя повторять выполненный эффект.
        if (row.lease_active || row.stream_active) throw new RecoveryError('LEASE_ACTIVE');
        if (row.processed || Number(row.consumer_cursor) >= Number(row.version))
          throw new RecoveryError('ALREADY_PROCESSED');
        if (row.status !== 'dead') throw new RecoveryError('NOT_DEAD');
        // SQL counter int4 должен иметь место для следующей попытки; иначе claim
        // неизменно падал бы на overflow, даже с новым budget base.
        if (row.attempts >= 2_147_483_647) throw new RecoveryError('ATTEMPT_LIMIT_REACHED');
        // Оба протокола должны стоять ровно перед этой версией: транспортный курсор
        // не заменяет курсор потребителя и не разрешает обойти dead-предшественника.
        if (
          Number(row.cursor) !== Number(row.version) - 1 ||
          Number(row.consumer_cursor) !== Number(row.version) - 1
        )
          throw new RecoveryError('PREDECESSOR_REQUIRED');
        // Один context проходит через владельца аудита и SQL планирования. Возврат из callback
        // ещё не commit; runner подтвердит всё вместе перед формированием результата CLI.
        const auditId = await this.audit.write(context, {
          actorType: 'user',
          actorId: command.operatorId,
          reasonCode: command.reasonCode,
          correlationId: command.correlationId,
          action: 'outbox.delivery-retry-scheduled',
          entityType: 'outbox-event',
          entityId: row.event_id,
        });
        const recoveryId = await this.repository.schedule(
          context,
          row,
          command,
          auditId,
          safeDeliveryError(row.last_error),
        );
        return {
          event: 'outbox.retry-scheduled',
          ...this.diagnostic(row),
          status: 'retry',
          recoveryId,
          auditId,
          operatorId: command.operatorId,
          reasonCode: command.reasonCode,
          administrationCorrelationId: command.correlationId,
          retryAttemptBase: row.attempts,
        };
      });
    } catch (error) {
      // SQLSTATE 55P03 может быть обёрнут Drizzle/драйвером: смотрим не более шести cause.
      // Не разбираем произвольное message, которое может содержать SQL или чувствительные данные.
      let cause: unknown = error;
      for (let i = 0; i < 6 && cause && typeof cause === 'object'; i++) {
        const value = cause as { code?: unknown; cause?: unknown };
        if (value.code === '55P03') throw new RecoveryError('DELIVERY_BUSY');
        cause = value.cause;
      }
      throw error;
    }
  }
  /** Читает локальные счётчики, не меняя очередь и не отправляя уведомления.
   * @param input Пороги, повторно проверяемые и при прямом вызове сервиса.
   * @returns Счётчики, пороги и ok/alert; числовой exit code устанавливает CLI.
   * @throws RecoveryError При неправильных порогах или отсутствии роли администратора. */
  async signal(input: BacklogThresholds) {
    const thresholds = validateThresholds(input);
    return this.transactions.run(async (context) => {
      await this.authorize(context);
      const state = await this.repository.signal(context);
      const alert =
        state.dead >= thresholds.deadLimit ||
        state.backlog >= thresholds.backlogLimit ||
        (state.backlog > 0 && state.oldestBacklogAgeSeconds >= thresholds.maxAgeSeconds);
      return {
        event: 'outbox.signal',
        status: alert ? ('alert' as const) : ('ok' as const),
        ...state,
        thresholds,
      };
    });
  }
  /** До чтения/изменения задаёт локальные таймауты и проверяет текущую роль БД.
   * Явное разрешение CLI не заменяет эту проверку; отказ прерывает всю транзакцию. */
  private async authorize(context: TransactionContext): Promise<void> {
    await this.repository.bound(context);
    if (!(await this.repository.isAdmin(context))) throw new RecoveryError('ADMIN_ROLE_REQUIRED');
  }
  /** Только явные диагностические поля: JSONB correlationId и last_error нельзя отражать без проверки. */
  private diagnostic(row: RecoverySnapshot) {
    const envelope = row.envelope as { correlationId?: unknown } | null;
    return deliveryDiagnostic({
      eventId: row.event_id,
      destination: row.destination,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      version: Number(row.version),
      attempt: row.attempts,
      correlationId: envelope?.correlationId,
      lastError: row.last_error,
    });
  }
  /** Собирает только разрешённые поля состояния. Срок и активность lease доступны оператору,
   * сам токен владения не выдаётся; дополнительные свойства SQL-строки не копируются. */
  private describe(row: RecoverySnapshot) {
    return {
      ...this.diagnostic(row),
      status: row.status,
      retryAttemptBase: row.retry_attempt_base,
      availableAt: this.iso(row.available_at),
      completedAt: this.iso(row.completed_at),
      lease: { until: this.iso(row.lease_until), active: row.lease_active },
      streamLease: { until: this.iso(row.stream_lease_until), active: row.stream_active },
      deliveryCursor: Number(row.cursor),
      consumerCursor: Number(row.consumer_cursor),
      processed: row.processed,
    };
  }
  /** Преобразует доверенное timestamptz из PostgreSQL в UTC ISO-строку, сохраняя null.
   * Некорректная дата приводит к ошибке чтения; подставлять выдуманное время нельзя. */
  private iso(value: string | null): string | null {
    return value === null ? null : new Date(value).toISOString();
  }
  /** При явном запросе проверяет весь envelope через EventContracts, затем выбирает первые 10 строк.
   * Неизвестные поля исключаются даже у валидного события; ошибка контракта возвращает redacted,
   * а не исходный payload или ошибку валидатора. Бизнес-ссылки этот preview не проверяет. */
  private payload(envelope: unknown, include: boolean) {
    if (!include) return { omitted: true };
    try {
      const event = this.contracts.parseForHandler(JSON.stringify(envelope));
      // Receipt preview не раскрывает неизвестный payload нового типа; факт доступен без raw данных.
      if (event.type !== 'receiving.receipt-posted') return { omitted: true };
      const payload = event.payload;
      return {
        receiptId: payload.receiptId,
        warehouseId: payload.warehouseId,
        receivingLocationId: payload.receivingLocationId,
        lineCount: payload.lines.length,
        truncated: payload.lines.length > 10,
        lines: payload.lines.slice(0, 10).map((line) => ({
          receiptLineId: line.receiptLineId,
          productId: line.productId,
          quantity: line.quantity,
        })),
      };
    } catch {
      return { redacted: true, reason: 'CONTRACT_REJECTED' };
    }
  }
}
