/** @file Фильтры списка orders: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class OrderSummaryQueryDto extends PageQueryDto {
  /** Точный фильтр status; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({
    enum: ['draft', 'active', 'cancel_pending', 'cancelled', 'completed', 'closed_mixed'],
  })
  @IsOptional()
  @IsIn(['draft', 'active', 'cancel_pending', 'cancelled', 'completed', 'closed_mixed'])
  status?: string;
}
