/** @file Публичное задание: безопасные ID, исполнитель, состояние и количества; без секретов сессии. */
import { ApiProperty } from '@nestjs/swagger';
import { PickingLineDto } from './picking-line.dto';
/** Снимок GET актуален; сохранённый HTTP replay возвращает исходный снимок команды. */
export class PickingTaskDto {
  /** UUID задания. */ @ApiProperty({ format: 'uuid' }) id!: string;
  /** UUID заказа-владельца. */ @ApiProperty({ format: 'uuid' }) orderId!: string;
  /** UUID фактического склада заказа. */ @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  /** Состояние, а не признак отгрузки. */ @ApiProperty({
    enum: ['ready', 'in_progress', 'shortage', 'completed', 'cancelled'],
  })
  status!: string;
  /** NULL до start; ID исполнителя сервер берёт из сессии. */ @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
  })
  assigneeId!: string | null;
  /** От 1 до 1000 строк резервов, а не обязательно 1000 разных SKU. */ @ApiProperty({
    type: [PickingLineDto],
    minItems: 1,
    maxItems: 1000,
  })
  lines!: PickingLineDto[];
}
