/** @file Read-only справочники web: warehouse grants → owner services → bounded JSON pages; публичного CRUD нет. */
import { Controller, Get, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { ApiReadPage } from './api-read-page.decorator';
import { PageQueryDto } from './dto/page-query.dto';
import { AccessService } from '../../modules/identity/services/access.service';
import { IdentityAccess, SessionPrincipal } from '../../modules/identity/identity.http';
import type { Principal } from '../../modules/identity/dto/principal.dto';
import { CatalogService } from '../../modules/catalog/services/catalog.service';
import { WarehousesService } from '../../modules/warehouses/services/warehouses.service';
import { ProductReadDto } from '../../modules/catalog/dto/product-read.dto';
import { WarehouseReadDto } from '../../modules/warehouses/dto/warehouse-read.dto';
import { LocationReadDto } from '../../modules/warehouses/dto/location-read.dto';
/** Только API composition; worker не импортирует HTTP/auth dependencies. */
@Controller('warehouses')
@IdentityAccess('business')
@ApiTags('directories')
@ApiCookieAuth('session')
export class DirectoryReadController {
  /** Сервисы владельцев экспортируются, repositories не доступны controller. */
  constructor(
    private readonly access: AccessService,
    private readonly catalog: CatalogService,
    private readonly warehouses: WarehousesService,
  ) {}
  /** Даже пустой список требует активную сессию; admin без grants видит пустую страницу. */
  @Get()
  @ApiReadPage(WarehouseReadDto)
  listWarehouses(@SessionPrincipal() p: Principal, @Query() q: PageQueryDto) {
    return this.access.run(async (c) =>
      this.warehouses.listReadableWarehouses(
        c,
        p.userId,
        await this.access.listReadableWarehouseIds(c, p),
        q,
      ),
    );
  }
  /** Каталог общий для организации, но вход требует read к указанному складу. */
  @Get(':warehouseId/products')
  @ApiReadPage(ProductReadDto)
  listProducts(
    @SessionPrincipal() p: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) id: string,
    @Query() q: PageQueryDto,
  ) {
    return this.access.run(async (c) => {
      await this.access.requireWarehouse(c, p, id, 'read');
      return this.catalog.listProducts(c, id, q);
    });
  }
  /** Складской predicate выполняется в SQL после ACL, не только фильтром клиента. */
  @Get(':warehouseId/locations')
  @ApiReadPage(LocationReadDto)
  listLocations(
    @SessionPrincipal() p: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) id: string,
    @Query() q: PageQueryDto,
  ) {
    return this.access.run(async (c) => {
      await this.access.requireWarehouse(c, p, id, 'read');
      return this.warehouses.listLocations(c, id, q);
    });
  }
}
