/** @file Внутренние DTO склада/ячеек; зона выражена kind ячейки, отдельной Zone entity пока нет. */
import type { OperationMetadata } from '../../../shared/operations/dto/operation-metadata.dto';
/** Допустимые назначения ячейки первого сценария. */
export type LocationKind = 'receiving' | 'storage' | 'shipping';
/** Создание склада с аудитом; код нормализуется uppercase. */
export interface CreateWarehouseDto extends OperationMetadata { readonly code: string; readonly name: string; }
/** Создание ячейки внутри существующего склада. */
export interface CreateLocationDto extends OperationMetadata { readonly warehouseId: string; readonly code: string; readonly kind: LocationKind; }
/** Публичная внутренняя модель склада без Drizzle типов. */
export interface WarehouseDto { readonly id: string; readonly code: string; readonly name: string; }
/** Ячейка принадлежит ровно одному складу. */
export interface LocationDto { readonly id: string; readonly warehouseId: string; readonly code: string; readonly kind: LocationKind; }
