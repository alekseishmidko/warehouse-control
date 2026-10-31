/** @file Публичный output WMS-204: явный безопасный JSON snapshot, без ORM классов. */
import { ApiProperty } from '@nestjs/swagger';
import { AllocationDto } from './allocation.dto';
/** GET актуален; replay возвращает снимок исходного commit. */
export class OrderLineDto {
  /** UUID строки. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** Товар строки. */ @ApiProperty({ format: 'uuid' }) productId!: string;
  /** Неизменное заказанное количество. */ @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
  })
  quantity!: number;
  /** Открытый остаток. */ @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647 })
  open!: number;
  /** Действующий storage резерв. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  reservedStorage!: number;
  /** Всегда 0 до реализации picking. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  reservedShipping!: number;
  /** Всегда 0 до реализации shipment. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  shipped!: number;
  /** Терминально отменённая часть. */ @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  cancelled!: number;
  /** Полная история распределения. */ @ApiProperty({ type: [AllocationDto] })
  allocations!: AllocationDto[];
}
