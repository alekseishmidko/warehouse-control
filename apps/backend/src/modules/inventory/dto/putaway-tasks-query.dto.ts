/** @file Фильтры списка putaway-tasks: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class PutawaySummaryQueryDto extends PageQueryDto {
  /** Точный фильтр productId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
  /** Точный фильтр status; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ enum: ['pending', 'completed'] })
  @IsOptional()
  @IsIn(['pending', 'completed'])
  status?: string;
  /** Точный фильтр sourceReceiptId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() sourceReceiptId?: string;
}
