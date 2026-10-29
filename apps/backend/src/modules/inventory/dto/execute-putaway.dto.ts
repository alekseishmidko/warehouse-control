/** @file Недоверенная HTTP команда полного размещения: выбирается только назначение, quantity/source/actor берутся сервером. */
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
/** Storage ячейка того же склада; существование, зону и права проверяют сервисы в общей транзакции. */
export class ExecutePutawayDto {
  /** UUID без coercion; нормализация lowercase до fingerprint. Другие поля HTTP pipe отклоняет. */
  @ApiProperty({
    format: 'uuid',
    description: 'Ячейка хранения того же склада; выполняется полное количество задания.',
  })
  @IsUUID()
  targetLocationId!: string;
}
