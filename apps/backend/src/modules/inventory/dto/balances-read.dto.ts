/** @file Публичная проекция balances: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Одна физическая позиция SKU/ячейки. Available вычисляется из того же SELECT; единицы — целые штуки. */
export class BalanceDto {
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
  /** Тип зоны определяет пригодность для операции; available в receiving/shipping не разрешает reserve. */
  @ApiProperty({ enum: ['receiving', 'storage', 'shipping'] }) locationKind!:
    'receiving' | 'storage' | 'shipping';
  /** Физическое учётное количество int4 в штуках. */ @ApiProperty({ type: Number, minimum: 0 })
  onHand!: number;
  /** Сумма active allocations, int4 в штуках. */ @ApiProperty({ type: Number, minimum: 0 })
  reserved!: number;
  /** Свободное учётное количество onHand - reserved, int4 в штуках. Резервировать можно только storage. */ @ApiProperty(
    {
      type: Number,
      minimum: 0,
    },
  )
  available!: number;
}
