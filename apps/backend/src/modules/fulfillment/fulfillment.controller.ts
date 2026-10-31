/** @file HTTP заказов: session/warehouse policy до idempotency replay, callback передаёт единый context сервису. */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiTags,
  ApiCookieAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { FulfillmentService } from './services/fulfillment.service';
import { AccessService } from '../identity/services/access.service';
import { Principal } from '../identity/dto/principal.dto';
import { IdentityAccess, SessionPrincipal } from '../identity/identity.http';
import { CommandContext, HttpCommand } from '../../infrastructure/http/http-command.decorator';
import { HttpCommandsService } from '../../infrastructure/idempotency/services/http-commands.service';
import { CommandScope } from '../../shared/operations/dto/command-scope.dto';
import { requireEmptyCommand } from '../../shared/validation/empty-command';
import { OrderDto } from './dto/order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ReserveOrderDto } from './dto/reserve-order.dto';
import { ReleaseAllocationDto } from './dto/release-allocation.dto';

/** Все команды закрыты warehouse policy, system_admin автоматически её не обходит. */
@ApiTags('orders')
@ApiCookieAuth('session')
@IdentityAccess('business')
@Controller('orders')
export class FulfillmentController {
  /** Только публичные сервисы; SQL и transaction commit не находятся в controller. */
  constructor(
    private readonly service: FulfillmentService,
    private readonly access: AccessService,
    private readonly commands: HttpCommandsService,
  ) {}
  /** GET показывает текущее состояние и обеспечение, с проверкой фактического склада. */
  @Get(':orderId')
  @ApiOkResponse({
    type: OrderDto,
    description:
      'Order snapshot: id, warehouseId, status, lines with open/reservedStorage/cancelled and allocation history',
  })
  get(@SessionPrincipal() p: Principal, @Param('orderId', new ParseUUIDPipe()) id: string) {
    return this.access.run(async (c) => {
      const warehouseId = await this.service.warehouse(c, id);
      await this.access.requireWarehouse(c, p, warehouseId, 'read');
      return this.service.read(c, id, 'share');
    });
  }
  /** Создание draft; compose order privilege требуется до claim. */
  @Post()
  @HttpCommand('fulfillment.order.create')
  @ApiCreatedResponse({ type: OrderDto, description: 'Draft order snapshot' })
  async create(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Body() body: CreateOrderDto,
    @Res() r: Response,
  ) {
    const normalized = this.service.normalize(body);
    const result = await this.commands.execute(
      s,
      normalized,
      async (c) => ({
        statusCode: 201,
        body: await this.service.create(c, normalized, { ...s, reasonCode: 'order-created' }),
      }),
      (c) => this.access.requireWarehouse(c, p, normalized.warehouseId, 'order'),
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
  /** Draft → active без автоматического резерва. */
  @Post(':orderId/confirm')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @HttpCode(200)
  @HttpCommand('fulfillment.order.confirm')
  @ApiOkResponse({ type: OrderDto, description: 'Active order snapshot' })
  confirm(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() r: Response,
  ) {
    requireEmptyCommand(body);
    return this.execute(p, s, id, 'confirm', undefined, r);
  }
  /** Явный вектор резервирования: весь запрос либо commit, либо rollback. */
  @Post(':orderId/reserve')
  @HttpCode(200)
  @HttpCommand('fulfillment.order.reserve')
  @ApiOkResponse({ type: OrderDto, description: 'Order snapshot with active allocations' })
  reserve(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: ReserveOrderDto,
    @Res() r: Response,
  ) {
    const normalized = {
      lines: body.lines
        .map((l) => ({ lineId: l.lineId.toLowerCase(), quantity: l.quantity }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId)),
    };
    return this.execute(p, s, id, 'reserve', normalized, r);
  }
  /** Release положительного количества своего allocation, без удаления истории. */
  @Post(':orderId/allocations/:allocationId/release')
  @HttpCode(200)
  @HttpCommand('fulfillment.order.release')
  @ApiOkResponse({ type: OrderDto, description: 'Order snapshot after release' })
  release(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Param('allocationId', new ParseUUIDPipe()) a: string,
    @Body() body: ReleaseAllocationDto,
    @Res() r: Response,
  ) {
    return this.execute(p, s, id, 'release', { quantity: body.quantity }, r, a.toLowerCase());
  }
  /** Отмена до сборки освобождает все allocations и закрывает заказ. */
  @Post(':orderId/cancel')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @HttpCode(200)
  @HttpCommand('fulfillment.order.cancel')
  @ApiOkResponse({ type: OrderDto, description: 'Cancelled order snapshot' })
  cancel(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() r: Response,
  ) {
    requireEmptyCommand(body);
    return this.execute(p, s, id, 'cancel', undefined, r);
  }
  /** Общий adapter mutations: нормализованный fingerprint и актуальная policy до replay. */
  private async execute(
    p: Principal,
    s: CommandScope,
    id: string,
    action: 'confirm' | 'reserve' | 'release' | 'cancel',
    body: ReserveOrderDto | ReleaseAllocationDto | undefined,
    r: Response,
    allocationId?: string,
  ) {
    id = id.toLowerCase();
    const result = await this.commands.execute(
      s,
      { id, action, body: body ?? {}, allocationId: allocationId ?? null },
      async (c) => ({
        statusCode: 200,
        body: await this.service.change(
          c,
          id,
          action,
          body,
          { ...s, reasonCode: `order-${action}` },
          allocationId,
        ),
      }),
      async (c) => {
        const warehouseId = await this.service.warehouse(c, id);
        await this.access.requireWarehouse(
          c,
          p,
          warehouseId,
          action === 'confirm' ? 'order' : action === 'reserve' ? 'reserve' : 'cancel',
        );
      },
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
}
