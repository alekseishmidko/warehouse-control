/** @file Публичная проекция shipments: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Краткий снимок документа/задания в одном SELECT. Строки и количества доступны через существующий detail GET. */
export class ShipmentSummaryDto {
  /** UUID сохранённой записи; используется как стабильный tie-breaker страницы. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** UUID фактического склада объекта; совпадает с авторизованным scope URL. */ @ApiProperty({
    format: 'uuid',
  })
  warehouseId!: string;
  /** UUID заказа-владельца; по нему определяется склад picking/shipment. */ @ApiProperty({
    format: 'uuid',
  })
  orderId!: string;
  /** Текущее состояние владельца на момент SELECT; между страницами оно может измениться. */ @ApiProperty(
    {
      enum: ['draft', 'posted', 'cancelled'],
    },
  )
  status!: 'draft' | 'posted' | 'cancelled';
  /** Сохранённый технический код основания операции, не свободный пользовательский текст. */ @ApiProperty(
    {
      type: String,
    },
  )
  reasonCode!: string;
  /** Время БД в UTC; точность шесть дробных знаков, не порядок commit. */ @ApiProperty({
    format: 'date-time',
  })
  createdAt!: string;
}
