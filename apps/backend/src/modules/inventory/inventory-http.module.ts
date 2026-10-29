/** @file Только API composition для putaway routes: отделяет Identity/Idempotency от worker graph InventoryModule. */
import { Module } from '@nestjs/common';
import { InventoryModule } from './inventory.module';
import { InventoryController } from './inventory.controller';
import { IdentityModule } from '../identity/identity.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
/** Не новый доменный модуль: HTTP adapter тех же таблиц inventory, worker его не импортирует. */
@Module({
  imports: [InventoryModule, IdentityModule, IdempotencyModule],
  controllers: [InventoryController],
})
export class InventoryHttpModule {}
