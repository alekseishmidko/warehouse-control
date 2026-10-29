/** @file HTTP input/output приёмки: transport DTO отделены от ORM и event envelope. */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_RECEIPT_LINES } from '../../../shared/events/event-registry';
import { MAX_STOCK_QUANTITY } from '../../../shared/quantities/quantity';

/** Недоверенная строка HTTP: только UUID товара и целое количество, без actor/lineId. */
export class CreateReceiptLineDto {
  /** Существующий товар; принадлежность проверяет CatalogService внутри транзакции. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  /** Штуки; строки/дроби/нулевые значения не преобразуются автоматически. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_STOCK_QUANTITY, example: 10 })
  @IsInt()
  @Min(1)
  @Max(MAX_STOCK_QUANTITY)
  quantity!: number;
}
/** Создание неизменяемого состава draft; максимум берётся из исходного event contract. */
export class CreateReceiptDto {
  /** Склад одной dev-организации, UUID нормализуется сервисом. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  /** Только ячейка receiving этого склада. */
  @ApiProperty({ format: 'uuid' }) @IsUUID() receivingLocationId!: string;
  /** Порядок значим для hash; повтор одного productId запрещён, даже с другим регистром UUID. */
  @ApiProperty({ type: [CreateReceiptLineDto], minItems: 1, maxItems: MAX_RECEIPT_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECEIPT_LINES)
  @ValidateNested({ each: true })
  @Type(() => CreateReceiptLineDto)
  lines!: CreateReceiptLineDto[];
}
/** Публичная строка результата; id — также стабильный operationId движения при posting. */
export class ReceiptLineDto extends CreateReceiptLineDto {
  /** Серверный UUID строки документа. */
  @ApiProperty({ format: 'uuid' }) id!: string;
  /** Номер строки от 1 до MAX_RECEIPT_LINES; порядок не зависит от UUID. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_RECEIPT_LINES }) position!: number;
}
/** JSON snapshot без Date/ORM-классов; одинаков для GET, команды и сохранённого replay. */
export class ReceiptDto {
  /** Серверный UUID документа. */
  @ApiProperty({ format: 'uuid' }) id!: string;
  /** Склад и receiving location зафиксированы при создании. */
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  /** Ячейка начисления при проведении. */
  @ApiProperty({ format: 'uuid' }) receivingLocationId!: string;
  /** Единственный переход состояния draft → posted. */
  @ApiProperty({ enum: ['draft', 'posted'] }) status!: 'draft' | 'posted';
  /** UTC время создания; timestamp преобразован в ISO на границе repository. */
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  /** UTC бизнес-время posting; совпадает с occurredAt события; null в draft. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt!: string | null;
  /** Идентификатор сохранённого outbox event, null в draft. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) postedEventId!: string | null;
  /** Состав документа; GET возвращает исходный порядок. */
  @ApiProperty({ type: [ReceiptLineDto], minItems: 1, maxItems: MAX_RECEIPT_LINES })
  lines!: ReceiptLineDto[];
}
