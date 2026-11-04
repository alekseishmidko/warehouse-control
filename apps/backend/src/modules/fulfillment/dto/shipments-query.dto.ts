/** @file Фильтры списка shipments: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class ShipmentSummaryQueryDto extends PageQueryDto {
  /** Точный фильтр status; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ enum: ['draft', 'posted', 'cancelled'] })
  @IsOptional()
  @IsIn(['draft', 'posted', 'cancelled'])
  status?: string;
  /** Точный фильтр orderId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() orderId?: string;
}
