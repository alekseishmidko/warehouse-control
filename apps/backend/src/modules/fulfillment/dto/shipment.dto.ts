/** @file Безопасный output shipment; статус posted означает списание, а не только подготовку. */
import { ApiProperty } from '@nestjs/swagger';
import { ShipmentLineDto } from './shipment-line.dto';
/** GET актуален, idempotency replay возвращает первоначальный снимок commit. */
export class ShipmentDto {
  /** UUID документа. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** UUID заказа. */ @ApiProperty({ format: 'uuid' }) orderId!: string;
  /** Фактический склад заказа. */ @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  /** Терминальные posted/cancelled назад не переходят. */ @ApiProperty({
    enum: ['draft', 'posted', 'cancelled'],
  })
  status!: string;
  /** Сохранённая причина подготовки; причины отмены дополнительно в audit. */ @ApiProperty()
  reasonCode!: string;
  /** UTC ISO при posted, иначе NULL. */ @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  postedAt!: string | null;
  /** Immutable выбранная партия. */ @ApiProperty({
    type: [ShipmentLineDto],
    minItems: 1,
    maxItems: 1000,
  })
  lines!: ShipmentLineDto[];
}
