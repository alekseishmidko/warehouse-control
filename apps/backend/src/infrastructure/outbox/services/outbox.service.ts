/** @file Outbox write interface: UUID/sequence allocation и validation в обязательном caller-owned context. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { KnownEvent } from '../../../shared/events/dto/event.dto';
import { EventContracts } from '../../../shared/events/services/event-contracts';
import { EventContractError } from '../../../shared/events/event-contract.error';
import { transactionClient } from '../../database/postgres-transaction-runner';
import { OutboxRepository } from '../repositories/outbox.repository';
import type { AppendEventDto } from '../dto/append-event.dto';

/** Экспортируемый сервис infrastructure; создание факта не означает delivery completion или commit. */
@Injectable()
export class OutboxService {
  private readonly contracts = new EventContracts();
  /** Получает внутренний SQL provider; соединение и транзакцию открывает только внешний владелец сценария. */
  constructor(private readonly repository: OutboxRepository) {}

  /**
   * Записывает один факт и обязательные доставки в транзакцию вызывающего сценария.
   * @returns Envelope с новым UUID и выделенной версией; commit ещё принадлежит caller.
   * @throws EventContractError при некорректном контракте; SQL/context/version errors также выходят наружу.
   * Все ошибки append нужно пропускать до TransactionRunner: их перехват с продолжением запрещён.
   * Повтор вызова создаёт новое событие; HTTP/consumer dedup реализуются отдельными задачами.
   */
  async append(context: TransactionContext, input: AppendEventDto): Promise<KnownEvent> {
    // Проверяем capability до подготовки данных; не создаём fallback transaction/pool.
    transactionClient(context);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.hasOwn(input, 'eventId') || Object.hasOwn(input, 'aggregateVersion')) {
      throw new EventContractError('INVALID_EVENT');
    }
    // Первый snapshot фиксирует вход до первого await и проверяет payload до счётчика.
    // UUID создаётся локально, без сетевого I/O. После rollback UUID не считается опубликованным.
    const eventId = randomUUID();
    const candidate = this.contracts.prepareForOutbox({ ...input, eventId, aggregateVersion: 1 });
    const version = await this.repository.nextVersion(context, candidate.event.aggregateType, candidate.event.aggregateId);
    // Повторная проверка обязательна: окончательная версия может увеличить число bytes сообщения.
    // Writer metadata задаётся повторно после JSON snapshot: даже input.toJSON не может
    // подменить выделенный UUID/sequence. Parsed snapshot уже не содержит исполняемых методов.
    const prepared = this.contracts.prepareForOutbox({ ...candidate.event, eventId, aggregateVersion: version });
    await this.repository.insert(context, prepared);
    return prepared.event;
  }
}
