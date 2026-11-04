/** @file Фильтры списка audit: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class AuditSummaryQueryDto extends PageQueryDto {
  /** Точный фильтр entityType; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({
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
  })
  @IsOptional()
  @IsIn([
    'warehouse',
    'location',
    'stock-balance',
    'allocation',
    'receipt',
    'putaway-task',
    'order',
    'picking-task',
    'shipment',
  ])
  entityType?: string;
  /** Точный фильтр entityId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() entityId?: string;
  /** Точный фильтр correlationId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() correlationId?: string;
}
