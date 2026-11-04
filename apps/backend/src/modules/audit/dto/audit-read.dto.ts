/** @file Публичная проекция audit: только перечисленные безопасные JSON поля. */
import { ApiProperty } from '@nestjs/swagger';
/** Безопасная metadata аудита одного склада, без JSON changes и credentials. Read не создаёт новую audit запись. */
export class AuditSummaryDto {
  /** UUID сохранённой записи; используется как стабильный tie-breaker страницы. */ @ApiProperty({
    format: 'uuid',
  })
  id!: string;
  /** Источник действия user/system; actorId трактуется вместе с этой категорией. */ @ApiProperty({
    type: String,
  })
  actorType!: string;
  /** UUID server-side субъекта аудита; логин и персональные данные здесь не выдаются. */ @ApiProperty(
    {
      format: 'uuid',
    },
  )
  actorId!: string;
  /** Техническое имя выполненного действия; не команда для повторного исполнения. */ @ApiProperty({
    type: String,
  })
  action!: string;
  /** Тип полиморфного объекта аудита; склад определяется retained связями этого типа. */ @ApiProperty(
    {
      enum: [
        'warehouse',
        'location',
        'stock-balance',
        'allocation',
        'receipt',
        'putaway-task',
        'order',
        'picking-task',
        'shipment',
      ],
    },
  )
  entityType!:
    | 'warehouse'
    | 'location'
    | 'stock-balance'
    | 'allocation'
    | 'receipt'
    | 'putaway-task'
    | 'order'
    | 'picking-task'
    | 'shipment';
  /** UUID объекта аудита; принадлежность складу проверена вместе с entityType. */ @ApiProperty({
    format: 'uuid',
  })
  entityId!: string;
  /** UUID связи действий одного сценария; сам по себе не предоставляет доступ к другим складам. */ @ApiProperty(
    {
      format: 'uuid',
    },
  )
  correlationId!: string;
  /** Сохранённый технический код основания операции, не свободный пользовательский текст. */ @ApiProperty(
    {
      type: String,
    },
  )
  reasonCode!: string;
  /** Признак маскирования исходных audit changes; сами changes в этой выдаче отсутствуют. */ @ApiProperty(
    { type: Boolean },
  )
  hasRedactedChanges!: boolean;
  /** Время записи аудита в UTC; не доказательство порядка commit. */ @ApiProperty({
    format: 'date-time',
  })
  occurredAt!: string;
}
