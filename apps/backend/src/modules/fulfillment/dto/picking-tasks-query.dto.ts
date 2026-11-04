/** @file Фильтры списка picking-tasks: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class PickingSummaryQueryDto extends PageQueryDto {
  /** Точный фильтр status; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ enum: ['ready', 'in_progress', 'shortage', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['ready', 'in_progress', 'shortage', 'completed', 'cancelled'])
  status?: string;
  /** Точный фильтр orderId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() orderId?: string;
  /** Точный фильтр assigneeId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() assigneeId?: string;
}
