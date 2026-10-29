/** @file Внутренние DTO catalog; только штуки, публичного HTTP API пока нет. */
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
/** Данные создания товара в существующей транзакции с обязательным audit. */
export interface CreateProductDto extends OperationMetadata {
  readonly sku: string;
  readonly name: string;
}
/** Минимальная модель товара без ORM leakage. */
export interface ProductDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly unit: 'piece';
}
