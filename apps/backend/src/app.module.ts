/** @file Корневой composition root: связывает технический HTTP, PostgreSQL и внутренние складские модули. */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { HttpModule } from './infrastructure/http/http.module';
import { IdempotencyModule } from './infrastructure/idempotency/idempotency.module';

/** Регистрирует HTTP-каркас, PostgreSQL, складские модули и outbox writer; бизнес HTTP/worker ещё нет. */
@Module({
  imports: [DatabaseModule, AuditModule, CatalogModule, WarehousesModule, InventoryModule, OutboxModule, HttpModule, IdempotencyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
