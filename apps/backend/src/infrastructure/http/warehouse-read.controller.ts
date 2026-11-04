/** @file API-only чтение склада: одна session/policy транзакция и публичные сервисы владельцев данных. */
import { ApiReadPage } from './api-read-page.decorator';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { IdentityAccess, SessionPrincipal } from '../../modules/identity/identity.http';
import { AccessService } from '../../modules/identity/services/access.service';
import type { Principal } from '../../modules/identity/dto/principal.dto';
import type { TransactionContext } from '../../shared/transactions/transaction.port';
import { InventoryReadService } from '../../modules/inventory/services/inventory-read.service';
import { ReceivingReadService } from '../../modules/receiving/services/receiving-read.service';
import { FulfillmentReadService } from '../../modules/fulfillment/services/fulfillment-read.service';
import { AuditReadService } from '../../modules/audit/services/audit-read.service';
import { BalanceQueryDto } from '../../modules/inventory/dto/balances-query.dto';
import { BalanceDto } from '../../modules/inventory/dto/balances-read.dto';
import { MovementQueryDto } from '../../modules/inventory/dto/movements-query.dto';
import { MovementDto } from '../../modules/inventory/dto/movements-read.dto';
import { PutawaySummaryQueryDto } from '../../modules/inventory/dto/putaway-tasks-query.dto';
import { PutawaySummaryDto } from '../../modules/inventory/dto/putaway-tasks-read.dto';
import { ReceiptSummaryQueryDto } from '../../modules/receiving/dto/receipts-query.dto';
import { ReceiptSummaryDto } from '../../modules/receiving/dto/receipts-read.dto';
import { OrderSummaryQueryDto } from '../../modules/fulfillment/dto/orders-query.dto';
import { OrderSummaryDto } from '../../modules/fulfillment/dto/orders-read.dto';
import { PickingSummaryQueryDto } from '../../modules/fulfillment/dto/picking-tasks-query.dto';
import { PickingSummaryDto } from '../../modules/fulfillment/dto/picking-tasks-read.dto';
import { ShipmentSummaryQueryDto } from '../../modules/fulfillment/dto/shipments-query.dto';
import { ShipmentSummaryDto } from '../../modules/fulfillment/dto/shipments-read.dto';
import { AuditSummaryQueryDto } from '../../modules/audit/dto/audit-query.dto';
import { AuditSummaryDto } from '../../modules/audit/dto/audit-read.dto';
/** Не новый бизнес-модуль: HTTP composition читает только через сервисы соответствующих владельцев. */
@Controller('warehouses/:warehouseId')
@ApiCookieAuth('session')
@ApiTags('warehouse-reads')
@IdentityAccess('business')
export class WarehouseReadController {
  /** Access.run держит user/session locks до выдачи результата callback; SQL не выходит из context. */
  constructor(
    private readonly access: AccessService,
    private readonly inventory: InventoryReadService,
    private readonly receiving: ReceivingReadService,
    private readonly fulfillment: FulfillmentReadService,
    private readonly audit: AuditReadService,
  ) {}
  /** GET balances: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('balances')
  @ApiReadPage(BalanceDto)
  listBalances(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: BalanceQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.inventory.listBalances(c, warehouseId, query),
    );
  }
  /** GET movements: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('movements')
  @ApiReadPage(MovementDto)
  listMovements(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: MovementQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.inventory.listMovements(c, warehouseId, query),
    );
  }
  /** GET putaway-tasks: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('putaway-tasks')
  @ApiReadPage(PutawaySummaryDto)
  listPutawayTasks(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: PutawaySummaryQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.inventory.listPutawayTasks(c, warehouseId, query),
    );
  }
  /** GET receipts: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('receipts')
  @ApiReadPage(ReceiptSummaryDto)
  listReceipts(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: ReceiptSummaryQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.receiving.listReceipts(c, warehouseId, query),
    );
  }
  /** GET orders: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('orders')
  @ApiReadPage(OrderSummaryDto)
  listOrders(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: OrderSummaryQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.fulfillment.listOrders(c, warehouseId, query),
    );
  }
  /** GET picking-tasks: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('picking-tasks')
  @ApiReadPage(PickingSummaryDto)
  listPickingTasks(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: PickingSummaryQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.fulfillment.listPickingTasks(c, warehouseId, query),
    );
  }
  /** GET shipments: read на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('shipments')
  @ApiReadPage(ShipmentSummaryDto)
  listShipments(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: ShipmentSummaryQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, false, (c) =>
      this.fulfillment.listShipments(c, warehouseId, query),
    );
  }
  /** GET audit: audit на указанный склад обязателен даже для пустого результата и повторного cursor. */
  @Get('audit')
  @ApiReadPage(AuditSummaryDto)
  listAuditEntries(
    @SessionPrincipal() principal: Principal,
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query() query: AuditSummaryQueryDto,
  ) {
    return this.readAuthorizedPage(principal, warehouseId, true, (c) =>
      this.audit.listAuditEntries(c, warehouseId, query),
    );
  }
  /** Policy выполняется до SQL и cursor decode. Отказ не возвращает ни строки, ни ключ продолжения. */
  private readAuthorizedPage<T>(
    principal: Principal,
    warehouseId: string,
    audit: boolean,
    read: (context: TransactionContext) => Promise<T>,
  ) {
    return this.access.run(async (c) => {
      await this.access.requireWarehouse(c, principal, warehouseId, audit ? 'audit' : 'read');
      return read(c);
    });
  }
}
