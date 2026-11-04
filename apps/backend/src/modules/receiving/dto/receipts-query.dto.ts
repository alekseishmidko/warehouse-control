/** @file Фильтры списка receipts: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class ReceiptSummaryQueryDto extends PageQueryDto {
  /** Точный фильтр status; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ enum: ['draft', 'posted'] })
  @IsOptional()
  @IsIn(['draft', 'posted'])
  status?: string;
  /** Точный фильтр receivingLocationId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() receivingLocationId?: string;
}
