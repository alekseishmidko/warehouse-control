/** @file Внутренние DTO inventory: ключ остатка, положительное начисление и результат без ORM rows. */
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
/** Идентичность физического остатка. */
export interface StockKeyDto {
  readonly warehouseId: string;
  readonly locationId: string;
  readonly productId: string;
}
/** Одно начисление одной строки: operationId уникален глобально для movement, не HTTP idempotency key. */
export interface ReceiveStockDto extends StockKeyDto, OperationMetadata {
  readonly quantity: number;
  readonly operationId: string;
}
/** Текущий баланс; available вычисляется как onHand-reserved, отдельной колонкой не хранится. */
export interface StockBalanceDto extends StockKeyDto {
  readonly id: string;
  readonly onHand: number;
  readonly reserved: number;
}
/** Возврат внутри callback ещё не commit; подтверждение — только после runner.run. */
export interface ReceiveStockResultDto {
  readonly balance: StockBalanceDto;
  readonly movementId: string;
  readonly auditId: string;
}
