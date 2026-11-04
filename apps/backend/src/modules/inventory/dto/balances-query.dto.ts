/** @file Фильтры списка balances: только точные значения, без произвольных SQL выражений. */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PageQueryDto } from '../../../infrastructure/http/dto/page-query.dto';
/** Недоверенные query значения; повторные/неизвестные параметры отклоняет global ValidationPipe. */
export class BalanceQueryDto extends PageQueryDto {
  /** Точный фильтр зоны; reserve разрешён только в storage. */
  @ApiPropertyOptional({ enum: ['receiving', 'storage', 'shipping'] })
  @IsOptional()
  @IsIn(['receiving', 'storage', 'shipping'])
  locationKind?: string;
  /** Точный фильтр productId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
  /** Точный фильтр locationId; отсутствие не ограничивает выборку внутри разрешённого склада. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() locationId?: string;
}
