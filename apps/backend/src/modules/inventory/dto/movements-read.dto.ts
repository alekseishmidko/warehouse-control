/** @file Публичная проекция movements: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Неизменяемый факт движения и его объясняющие связи. Количество положительное, направление задаёт kind. */
export class MovementDto {
  /** UUID сохранённой записи; используется как стабильный tie-breaker страницы. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** UUID фактического склада объекта; совпадает с авторизованным scope URL. */ @ApiProperty({
    format: 'uuid',
  })
  warehouseId!: string;
  /** UUID товара в каталоге; название и SKU этим DTO не дублируются. */ @ApiProperty({
    format: 'uuid',
  })
  productId!: string;
  /** UUID ячейки баланса или движения; принадлежность складу защищена FK. */ @ApiProperty({
    format: 'uuid',
  })
  locationId!: string;
  /** Направление движения: receipt/transfer-in увеличивает stock, transfer-out/shipment уменьшает. */ @ApiProperty(
    {
      enum: ['receipt', 'transfer-out', 'transfer-in', 'shipment'],
    },
  )
  kind!: 'receipt' | 'transfer-out' | 'transfer-in' | 'shipment';
  /** Положительное количество int4 в штуках. */ @ApiProperty({ type: Number, minimum: 1 })
  quantity!: number;
  /** UUID объясняющего audit entry; audit view дополнительно требует право audit. */ @ApiProperty({
    format: 'uuid',
  })
  auditId!: string;
  /** Уникальный UUID основания движения; не HTTP idempotency key и не порядок фактов. */ @ApiProperty(
    {
      format: 'uuid',
    },
  )
  operationId!: string;
  /** UUID выполненного putaway задания для этой пары; NULL у других оснований движения. */ @ApiProperty(
    {
      format: 'uuid',
      nullable: true,
      type: String,
    },
  )
  transferId!: string | null;
  /** UUID переноса резерва при сборке; NULL, если движение создано другим сценарием. */ @ApiProperty(
    { format: 'uuid', nullable: true, type: String },
  )
  pickingTransferId!: string | null;
  /** UUID retained ship/return эффекта; NULL для receipt/putaway/picking. */ @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
  })
  shippingEffectId!: string | null;
  /** Время БД в UTC; точность шесть дробных знаков, не порядок commit. */ @ApiProperty({
    format: 'date-time',
  })
  createdAt!: string;
}
