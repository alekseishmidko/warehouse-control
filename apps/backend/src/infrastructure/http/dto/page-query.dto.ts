/** @file Общие query параметры HTTP списка; числа не преобразуются неявно из массивов/объектов. */
import { PAGE_LIMIT_PATTERN, DEFAULT_PAGE_LIMIT } from '../../../shared/pagination/keyset-page';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
/** Недоверенный HTTP input; global validation отклоняет неизвестные свойства. */
export class PageQueryDto {
  /** Каноническая десятичная строка 1..100, default 20; OFFSET и произвольный sort не поддерживаются. */
  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, pattern: PAGE_LIMIT_PATTERN.source })
  @IsOptional()
  @IsString()
  @Matches(PAGE_LIMIT_PATTERN)
  limit?: string;
  /** Непрозрачный bounded ключ продолжения. Проверяется после авторизации вместе с фильтрами. */
  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
