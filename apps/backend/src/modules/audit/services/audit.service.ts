/** @file AuditService: публичный сервис модуля, проверяет/маскирует input и делегирует запись repository. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import type { AuditEntryInput } from '../dto/audit-entry.dto';
import { prepareAuditEntry } from '../audit-entry';
import { AuditRepository } from '../repositories/audit.repository';

/** Владелец правил записи истории; другие модули вызывают сервис, не AuditRepository или таблицу. */
@Injectable()
export class AuditService {
  /** Получает конкретный repository через Nest DI; отдельный interface/token без необходимости не вводится. */
  constructor(private readonly repository: AuditRepository) {}

  /** Записывает безопасный audit в транзакции вызывающего сервиса; ошибки должны откатить весь сценарий. */
  async write(context: TransactionContext, input: AuditEntryInput): Promise<string> {
    return this.repository.insert(context, prepareAuditEntry(input));
  }
}
