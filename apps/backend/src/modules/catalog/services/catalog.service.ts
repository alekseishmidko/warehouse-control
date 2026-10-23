/** @file Публичный CatalogService: нормализация товара, обязательный audit и lookup для inventory. */
import { Injectable } from '@nestjs/common';
import { CommandError } from '../../../shared/errors/command-error';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { requireUuid } from '../../../shared/validation/identifiers';
import { normalizeCode, normalizeName } from '../../../shared/validation/resource-fields';
import { AuditService } from '../../audit/services/audit.service';
import { CatalogRepository } from '../repositories/catalog.repository';
import type { CreateProductDto, ProductDto } from '../dto/product.dto';
/** Модуль-владелец SKU; не начисляет остатки. */
@Injectable()
export class CatalogService {
  /** Внедряет собственный repository и AuditService; других repositories не использует. */
  constructor(private readonly repository: CatalogRepository, private readonly audit: AuditService) {}
  /** Создаёт товар и audit в переданном context; повтор SKU — ошибка, не upsert. */
  async create(context: TransactionContext, input: CreateProductDto): Promise<ProductDto> {
    const row = await this.repository.create(context, normalizeCode(input.sku, 'sku'), normalizeName(input.name));
    await this.audit.write(context, { ...input, action: 'catalog.product-created', entityType: 'product', entityId: row.id });
    return row;
  }
  /** Проверяет UUID/наличие товара; PRODUCT_NOT_FOUND — безопасный отказ, SQL ошибки не подавляются. */
  async requireProduct(context: TransactionContext, id: string): Promise<ProductDto> {
    requireUuid(id, 'productId'); const row = await this.repository.findById(context, id);
    if (!row) throw new CommandError('PRODUCT_NOT_FOUND'); return row;
  }
}
