/** @file Публичная проекция receipts: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Краткий снимок документа/задания в одном SELECT. Строки и количества доступны через существующий detail GET. */
export class ReceiptSummaryDto {
  /** UUID сохранённой записи; используется как стабильный tie-breaker страницы. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** UUID фактического склада объекта; совпадает с авторизованным scope URL. */ @ApiProperty({
    format: 'uuid',
  })
  warehouseId!: string;
  /** UUID receiving-ячейки, в которую проведённая приёмка начисляет товар. */ @ApiProperty({
    format: 'uuid',
  })
  receivingLocationId!: string;
  /** Текущее состояние владельца на момент SELECT; между страницами оно может измениться. */ @ApiProperty(
    {
      enum: ['draft', 'posted'],
    },
  )
  status!: 'draft' | 'posted';
  /** UUID события проведения приёмки; NULL у ещё не проведённого draft. */ @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
  })
  postedEventId!: string | null;
  /** Время БД в UTC; точность шесть дробных знаков, не порядок commit. */ @ApiProperty({
    format: 'date-time',
  })
  createdAt!: string;
}
