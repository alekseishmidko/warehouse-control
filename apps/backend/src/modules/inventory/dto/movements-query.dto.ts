/** @file Фильтры списка movements: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class MovementQueryDto extends PageQueryDto {
  /** Точный фильтр productId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
  /** Точный фильтр locationId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() locationId?: string;
  /** Точный фильтр kind; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ enum: ['receipt', 'transfer-out', 'transfer-in', 'shipment'] })
  @IsOptional()
  @IsIn(['receipt', 'transfer-out', 'transfer-in', 'shipment'])
  kind?: string;
  /** Точный фильтр auditId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() auditId?: string;
}
