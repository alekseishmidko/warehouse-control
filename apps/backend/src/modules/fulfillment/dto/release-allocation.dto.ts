/** @file Явный release части allocation; нет TTL, expiresAt или автоматического expiration. */
import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
/** AllocationId задаётся path; server проверяет его заказ/склад, active и зону до изменения reserved. */
export class ReleaseAllocationDto {
  /** Количество освобождения: положительное int4, не больше active allocation. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
