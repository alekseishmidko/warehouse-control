/** @file Внутренний сценарий inventory: из receipt fact создаёт tasks с immutable основанием и audit в borrowed context, без stock credit. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { EventContracts } from '../../../shared/events/services/event-contracts';
import { PutawayRepository } from '../repositories/putaway.repository';
import { AuditService } from '../../audit/services/audit.service';
import type { CreatePutawayTasksDto, PutawayTaskDto } from '../dto/putaway-task.dto';

/** Semantic отказ без raw payload. Transport adapter handler отображает его в permanent HANDLER_REJECTED. */
export class PutawayInputError extends Error {
  /** Безопасный semantic отказ без исходных значений; вызывающий handler не должен подавлять rollback. */
  constructor() {
    super('Invalid putaway source');
  }
}
/** Не экспортируется модулем: межмодульный вход — InventoryService.createPutawayTasks. */
@Injectable()
export class PutawayService {
  private readonly contracts = new EventContracts();
  /** Зависит только от собственного SQL и публичного audit; не импортирует ReceivingService или worker. */
  constructor(
    private readonly repository: PutawayRepository,
    private readonly audit: AuditService,
  ) {}
  /**
   * @param context Transaction worker: task/audit/processed marker/cursors должны иметь общий commit.
   * @param input Receipt fact и доверенный server actor; TS не заменяет runtime schema/semantic validation.
   * @returns Созданные либо уже существующие идентичные tasks; до внешнего commit результат не подтверждён.
   * @throws PutawayInputError при неверной связи aggregate/payload, duplicates или конфликтующем повторе.
   * @throws Error Ошибка schema/audit/SQL полностью откатывает callback; run/retry и внешнего I/O здесь нет.
   */
  async create(
    context: TransactionContext,
    input: CreatePutawayTasksDto,
  ): Promise<PutawayTaskDto[]> {
    // Snapshot до первого await: дальнейшая мутация caller input не меняет сохранённые основания.
    const event = this.contracts.prepareForOutbox(input.event).event;
    if (
      event.type !== 'receiving.receipt-posted' ||
      event.aggregateType !== 'receipt' ||
      event.aggregateId.toLowerCase() !== event.payload.receiptId.toLowerCase()
    )
      throw new PutawayInputError();
    const seenLines = new Set<string>();
    const seenProducts = new Set<string>();
    for (const line of event.payload.lines) {
      const lineId = line.receiptLineId.toLowerCase();
      const productId = line.productId.toLowerCase();
      if (seenLines.has(lineId) || seenProducts.has(productId)) throw new PutawayInputError();
      seenLines.add(lineId);
      seenProducts.add(productId);
    }
    const tasks: PutawayTaskDto[] = [];
    // Один порядок unique keys для прямых concurrent callers. Нормальный worker
    // дополнительно сериализует stream и marker до вызова этого сценария.
    for (const line of [...event.payload.lines].sort((a, b) =>
      a.receiptLineId.localeCompare(b.receiptLineId),
    )) {
      const source = {
        sourceReceiptId: event.payload.receiptId.toLowerCase(),
        sourceReceiptLineId: line.receiptLineId.toLowerCase(),
        sourceEventId: event.eventId.toLowerCase(),
        warehouseId: event.payload.warehouseId.toLowerCase(),
        sourceLocationId: event.payload.receivingLocationId.toLowerCase(),
        productId: line.productId.toLowerCase(),
        quantity: line.quantity,
      };
      const existing = await this.repository.findBySourceLine(context, source.sourceReceiptLineId);
      if (existing) {
        // Нельзя маскировать новый event/quantity как успешный duplicate. При точном
        // повторе не создаём новый audit: task и его основание остаются прежними.
        if (
          (Object.keys(source) as Array<keyof typeof source>).some(
            (key) => existing[key] !== source[key],
          )
        )
          throw new PutawayInputError();
        tasks.push(existing);
        continue;
      }
      const id = randomUUID();
      const auditId = await this.audit.write(context, {
        ...input,
        action: 'inventory.putaway-task-created',
        entityType: 'putaway-task',
        entityId: id,
        changes: {
          quantity: { after: source.quantity },
          productId: { after: source.productId },
          warehouseId: { after: source.warehouseId },
          locationId: { after: source.sourceLocationId },
        },
      });
      tasks.push(
        await this.repository.insert(context, { ...source, id, status: 'pending', auditId }),
      );
    }
    return tasks;
  }
}
