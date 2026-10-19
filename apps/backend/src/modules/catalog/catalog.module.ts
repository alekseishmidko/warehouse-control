/** @file Nest CatalogModule: private repository, exported CatalogService; без HTTP CRUD. */
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogService } from './services/catalog.service';
import { CatalogRepository } from './repositories/catalog.repository';
/** Публикует только сервис владельца товара. */
@Module({ imports: [AuditModule], providers: [CatalogRepository, CatalogService], exports: [CatalogService] })
export class CatalogModule {}
