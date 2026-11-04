/** @file Публичная проекция orders: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Краткий снимок документа/задания в одном SELECT. Строки и количества доступны через существующий detail GET. */
export class OrderSummaryDto {
  /** UUID сохранённой записи; используется как стабильный tie-breaker страницы. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** UUID фактического склада объекта; совпадает с авторизованным scope URL. */ @ApiProperty({
    format: 'uuid',
  })
  warehouseId!: string;
  /** Текущее состояние владельца на момент SELECT; между страницами оно может измениться. */ @ApiProperty(
    {
      enum: ['draft', 'active', 'cancel_pending', 'cancelled', 'completed', 'closed_mixed'],
    },
  )
  status!: 'draft' | 'active' | 'cancel_pending' | 'cancelled' | 'completed' | 'closed_mixed';
}
