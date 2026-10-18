/** @file AuditRepository: PostgreSQL INSERT через обязательный существующий transaction context. */
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { PreparedAuditEntry } from '../dto/audit-entry.dto';
import { auditEntries } from '../audit.schema';

/** Владеет SQL audit-модуля; не открывает транзакции, не выполняет validation или внешнее I/O. */
@Injectable()
export class AuditRepository {
  /** Добавляет подготовленную запись и возвращает UUID; отсутствие активного context/SQL ошибка отклоняет Promise. */
  async insert(context: TransactionContext, entry: PreparedAuditEntry): Promise<string> {
    const client = transactionClient(context);
    const [record] = await client.insert(auditEntries).values(entry).returning({ id: auditEntries.id });
    return record.id;
  }
}
