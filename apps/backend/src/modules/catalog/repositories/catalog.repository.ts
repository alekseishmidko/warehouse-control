/** @file Catalog SQL: создание и поиск по id через borrowed transaction client. */
import { sql } from 'drizzle-orm';
import { readKeysetPage } from '../../../infrastructure/database/read-keyset-page';
import type { PageRequest } from '../../../shared/pagination/keyset-page';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transactionClient } from '../../../infrastructure/database/postgres-transaction-runner';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { products } from '../catalog.schema';
import type { ProductDto } from '../dto/product.dto';
/** Внутренний provider, не экспортируется другим модулям. */
@Injectable()
export class CatalogRepository {
  /** Справочник организации доступен только после warehouse read policy; значения не зависят от остатков. */
  listProducts(context: TransactionContext, page: PageRequest) {
    return readKeysetPage<import('../dto/product-read.dto').ProductReadDto>(context, page, {
      from: sql`products p`,
      id: sql`p.id`,
      projection: sql`p.id,p.sku,p.name,p.unit`,
      where: sql`true`,
    });
  }

  /** INSERT, без собственного commit; unique violation передаётся вызывающему. */
  async create(context: TransactionContext, sku: string, name: string): Promise<ProductDto> {
    const [row] = await transactionClient(context)
      .insert(products)
      .values({ sku, name })
      .returning();
    return row;
  }
  /** Читает только product table владельца; null если товар отсутствует. */
  async findById(context: TransactionContext, id: string): Promise<ProductDto | null> {
    const [row] = await transactionClient(context)
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    return row ?? null;
  }
}
