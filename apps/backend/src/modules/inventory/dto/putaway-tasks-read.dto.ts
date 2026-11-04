/** @file Публичная проекция putaway-tasks: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Краткий снимок документа/задания в одном SELECT. Строки и количества доступны через существующий detail GET. */
export class PutawaySummaryDto {
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
  /** UUID проведённой приёмки, которая стала основанием задания. */ @ApiProperty({
    format: 'uuid',
  })
  sourceReceiptId!: string;
  /** UUID retained ReceivingPosted: связывает приёмку, worker delivery и задание. */ @ApiProperty({
    format: 'uuid',
  })
  sourceEventId!: string;
  /** Текущее состояние владельца на момент SELECT; между страницами оно может измениться. */ @ApiProperty(
    {
      enum: ['pending', 'completed'],
    },
  )
  status!: 'pending' | 'completed';
  /** Положительное количество int4 в штуках. */ @ApiProperty({ type: Number, minimum: 1 })
  quantity!: number;
  /** Время БД в UTC; точность шесть дробных знаков, не порядок commit. */ @ApiProperty({
    format: 'date-time',
  })
  createdAt!: string;
}
