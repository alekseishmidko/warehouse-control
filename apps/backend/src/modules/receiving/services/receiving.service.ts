/** @file Вертикальный receiving: draft и posting заимствуют command context; GET владеет read transaction. */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  TRANSACTION_RUNNER,
  TransactionContext,
  TransactionRunner,
} from '../../../shared/transactions/transaction.port';
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
import { CommandError } from '../../../shared/errors/command-error';
import { requireUuid } from '../../../shared/validation/identifiers';
import { MAX_RECEIPT_LINES } from '../../../shared/events/event-registry';
import { isStockQuantity } from '../../../shared/quantities/quantity';
import { AuditService } from '../../audit/services/audit.service';
import { CatalogService } from '../../catalog/services/catalog.service';
import { WarehousesService } from '../../warehouses/services/warehouses.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { OutboxService } from '../../../infrastructure/outbox/services/outbox.service';
import { ReceivingRepository } from '../repositories/receiving.repository';
import { CreateReceiptDto, ReceiptDto } from '../dto/receipt.dto';

/** Экспортируемый владелец документа; не пишет чужие таблицы и не выполняет внешнее I/O. */
@Injectable()
export class ReceivingService {
  /** DI связывает публичные сервисы владельцев; runner нужен только для отдельного GET. */
  constructor(
    private readonly repository: ReceivingRepository,
    private readonly catalog: CatalogService,
    private readonly warehouses: WarehousesService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Нормализует HTTP DTO в plain JSON до hash; повтор с другим регистром UUID эквивалентен.
   * @throws CommandError INVALID_RECEIPT при неверном количестве/лимите/повторе товара.
   * Внутренние callers также обязаны пройти эту проверку; SQL эффекты отсутствуют.
   */
  normalize(input: CreateReceiptDto): CreateReceiptDto {
    requireUuid(input.warehouseId, 'warehouseId');
    requireUuid(input.receivingLocationId, 'receivingLocationId');
    if (
      !Array.isArray(input.lines) ||
      input.lines.length < 1 ||
      input.lines.length > MAX_RECEIPT_LINES
    )
      throw new CommandError('INVALID_RECEIPT');
    const seen = new Set<string>();
    const lines = input.lines.map((line) => {
      requireUuid(line.productId, 'productId');
      const productId = line.productId.toLowerCase();
      if (!isStockQuantity(line.quantity) || line.quantity === 0 || seen.has(productId))
        throw new CommandError('INVALID_RECEIPT');
      seen.add(productId);
      return { productId, quantity: line.quantity };
    });
    return {
      warehouseId: input.warehouseId.toLowerCase(),
      receivingLocationId: input.receivingLocationId.toLowerCase(),
      lines,
    };
  }

  /**
   * Создаёт draft без stock/outbox. Вход недоверенный, metadata задаёт авторизованный caller.
   * Проверяет существование склада через принадлежащую ему FK-backed location, затем товары.
   * @returns JSON snapshot; он подтверждён только после commit внешнего HttpCommandsService.
   * @throws CommandError при неверных refs/kind/строках; SQL/audit ошибки выходят до runner.
   */
  async create(
    context: TransactionContext,
    input: CreateReceiptDto,
    metadata: OperationMetadata,
  ): Promise<ReceiptDto> {
    const normalized = this.normalize(input);
    await this.requireReceivingLocation(
      context,
      normalized.warehouseId,
      normalized.receivingLocationId,
    );
    for (const line of normalized.lines) await this.catalog.requireProduct(context, line.productId);
    const document = await this.repository.create(
      context,
      {
        id: randomUUID(),
        warehouseId: normalized.warehouseId,
        receivingLocationId: normalized.receivingLocationId,
      },
      normalized.lines.map((line, index) => ({ ...line, id: randomUUID(), position: index + 1 })),
    );
    await this.audit.write(context, {
      ...metadata,
      action: 'receiving.receipt-created',
      entityType: 'receipt',
      entityId: document.id,
      changes: {
        status: { after: 'draft' },
        warehouseId: { after: document.warehouseId },
        locationId: { after: document.receivingLocationId },
      },
    });
    return document;
  }

  /**
   * Проводит документ ровно один раз по состоянию, а HTTP replay отдельно обслуживает dedup.
   * @param context Общая транзакция HTTP claim/result, inventory, audit и outbox; здесь run/commit нет.
   * @param id UUID документа; actor берётся только из server metadata, никогда из body.
   * @returns Posted snapshot после всех записей, но до commit владельца context.
   * @throws CommandError RECEIPT_NOT_FOUND/RECEIPT_ALREADY_POSTED/ошибки stock; любая ошибка откатывает всё.
   */
  async post(
    context: TransactionContext,
    id: string,
    metadata: OperationMetadata,
  ): Promise<ReceiptDto> {
    requireUuid(id, 'receiptId');
    // Сначала parent lock, затем состояние и immutable lines. Разные HTTP keys
    // сериализуются здесь; второй запрос после commit первого получает 409 без начисления.
    const document = await this.repository.find(context, id.toLowerCase(), true);
    if (!document) throw new CommandError('RECEIPT_NOT_FOUND');
    if (document.status !== 'draft') throw new CommandError('RECEIPT_ALREADY_POSTED');
    this.normalize(document);
    await this.requireReceivingLocation(
      context,
      document.warehouseId,
      document.receivingLocationId,
    );
    // Несколько документов могут затрагивать одни balances. Один порядок productId
    // уменьшает риск deadlock; исходный порядок строк остаётся в документе/событии.
    for (const line of [...document.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      await this.inventory.receive(context, {
        ...metadata,
        warehouseId: document.warehouseId,
        locationId: document.receivingLocationId,
        productId: line.productId,
        quantity: line.quantity,
        operationId: line.id,
      });
    }
    await this.audit.write(context, {
      ...metadata,
      action: 'receiving.receipt-posted',
      entityType: 'receipt',
      entityId: document.id,
      changes: { status: { before: 'draft', after: 'posted' } },
    });
    const postedAt = new Date().toISOString();
    const [first, ...rest] = document.lines.map((line) => ({
      receiptLineId: line.id,
      productId: line.productId,
      quantity: line.quantity,
    }));
    // Generated type отражает minItems=1 tuple; runtime проверка выше гарантирует first.
    if (!first) throw new CommandError('INVALID_RECEIPT');
    const event = await this.outbox.append(context, {
      type: 'receiving.receipt-posted',
      schemaVersion: 1,
      aggregateType: 'receipt',
      aggregateId: document.id,
      occurredAt: postedAt,
      correlationId: metadata.correlationId,
      payload: {
        receiptId: document.id,
        warehouseId: document.warehouseId,
        receivingLocationId: document.receivingLocationId,
        lines: [first, ...rest],
      },
    });
    // Ошибки после append нельзя подавлять: counter, delivery и весь stock должны откатиться.
    await this.repository.markPosted(context, document.id, postedAt, event.eventId);
    return { ...document, status: 'posted', postedAt, postedEventId: event.eventId };
  }

  /** GET после HTTP guard: открывает только read transaction; не вызывать внутри command callback. */
  async get(id: string): Promise<ReceiptDto> {
    return this.transactions.run((context) => this.read(context, id));
  }

  /** Читает документ в borrowed context для ACL и команды; не создаёт вложенную транзакцию. */
  async read(context: TransactionContext, id: string): Promise<ReceiptDto> {
    requireUuid(id, 'receiptId');
    const document = await this.repository.find(context, id.toLowerCase());
    if (!document) throw new CommandError('RECEIPT_NOT_FOUND');
    return document;
  }

  /** Проверяет реальный склад/ownership через публичный сервис владельца; storage/shipping отклоняются. */
  private async requireReceivingLocation(
    context: TransactionContext,
    warehouseId: string,
    locationId: string,
  ): Promise<void> {
    const location = await this.warehouses.requireLocation(context, warehouseId, locationId);
    if (location.kind !== 'receiving') throw new CommandError('INVALID_RECEIVING_LOCATION');
  }
}
