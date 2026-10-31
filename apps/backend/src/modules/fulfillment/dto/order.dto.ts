/** @file Публичный output WMS-204: явный безопасный JSON snapshot, без ORM классов. */
import { ApiProperty } from '@nestjs/swagger';
import { OrderLineDto } from './order-line.dto';
/** GET актуален; replay возвращает снимок исходного commit. */
export class OrderDto {
  /** UUID заказа. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** Один склад. */ @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  /** Состояние заказа. */ @ApiProperty({ enum: ['draft', 'active', 'cancelled'] }) status!:
    'draft' | 'active' | 'cancelled';
  /** Состав и обеспечение. */ @ApiProperty({ type: [OrderLineDto] }) lines!: OrderLineDto[];
}
