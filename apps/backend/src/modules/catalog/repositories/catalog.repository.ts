/** @file Catalog SQL: создание и поиск по id через borrowed transaction client. */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { products } from '../catalog.schema';
import type { ProductDto } from '../dto/product.dto';
/** Внутренний provider, не экспортируется другим модулям. */
@Injectable()
export class CatalogRepository {
  /** INSERT, без собственного commit; unique violation передаётся вызывающему. */
  async create(context: TransactionContext, sku: string, name: string): Promise<ProductDto> {
    const [row] = await transactionClient(context).insert(products).values({ sku, name }).returning(); return row;
  }
  /** Читает только product table владельца; null если товар отсутствует. */
  async findById(context: TransactionContext, id: string): Promise<ProductDto | null> {
    const [row] = await transactionClient(context).select().from(products).where(eq(products.id, id)).limit(1); return row ?? null;
  }
}
