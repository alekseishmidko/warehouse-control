/** @file HTTP отгрузки/физического возврата: session/CSRF/warehouse policy до idempotency replay, один command context. */
import { Controller, Post, Get, Body, Param, ParseUUIDPipe, Res, HttpCode } from '@nestjs/common';
import {
  ApiTags,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ShippingService } from './services/shipping.service';
import { FulfillmentService } from './services/fulfillment.service';
import { AccessService } from '../identity/services/access.service';
import { Principal } from '../identity/dto/principal.dto';
import { IdentityAccess, SessionPrincipal } from '../identity/identity.http';
import { HttpCommand, CommandContext } from '../../infrastructure/http/http-command.decorator';
import { HttpCommandsService } from '../../infrastructure/idempotency/services/http-commands.service';
import { CommandScope } from '../../shared/operations/dto/command-scope.dto';
import { CommandError } from '../../shared/errors/command-error';
import { requireEmptyCommand } from '../../shared/validation/empty-command';
import { PrepareShipmentDto } from './dto/prepare-shipment.dto';
import { CancellationReturnDto } from './dto/cancellation-return.dto';
import { ReasonDto } from './dto/reason.dto';
import { ShipmentDto } from './dto/shipment.dto';
import { OrderDto } from './dto/order.dto';
/** Ship право требуется для документов отгрузки, return — для подтверждения физического возврата. */
@Controller()
@ApiTags('shipping')
@ApiCookieAuth('session')
@IdentityAccess('business')
export class ShippingController {
  /** DI публичных владельцев и локального ShippingService; I/O только в методах. */
  constructor(
    private readonly shipping: ShippingService,
    private readonly orders: FulfillmentService,
    private readonly access: AccessService,
    private readonly commands: HttpCommandsService,
  ) {}
  /** GET читает согласованный снимок после проверки склада. */
  @Get('shipments/:shipmentId')
  @ApiOkResponse({ type: ShipmentDto })
  read(@SessionPrincipal() p: Principal, @Param('shipmentId', new ParseUUIDPipe()) id: string) {
    return this.access.run(async (c) => {
      const { warehouseId } = await this.shipping.findShipmentWarehouse(c, id);
      await this.access.requireWarehouse(c, p, warehouseId, 'read');
      return this.shipping.readShipment(c, id, true);
    });
  }
  /** Подготовка explicit staged вектора, не резервирует товар повторно. */
  @Post('orders/:orderId/shipments')
  @HttpCommand('fulfillment.shipment.prepare')
  @ApiCreatedResponse({ type: ShipmentDto })
  async prepare(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: PrepareShipmentDto,
    @Res() r: Response,
  ) {
    id = id.toLowerCase();
    const normalized = {
      reasonCode: body.reasonCode,
      lines: body.lines
        .map((l) => ({ allocationId: l.allocationId.toLowerCase(), quantity: l.quantity }))
        .sort((a, b) => a.allocationId.localeCompare(b.allocationId)),
    };
    if (new Set(normalized.lines.map((l) => l.allocationId)).size !== normalized.lines.length)
      throw new CommandError('VALIDATION_FAILED');
    const result = await this.commands.execute(
      s,
      { orderId: id, ...normalized },
      async (c) => ({
        statusCode: 201,
        body: await this.shipping.prepareShipment(c, id, normalized, {
          ...s,
          reasonCode: normalized.reasonCode,
        }),
      }),
      async (c) => this.access.requireWarehouse(c, p, await this.orders.warehouse(c, id), 'ship'),
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
  /** Проводит весь immutable состав; новый ключ на posted получает 409. */
  @Post('shipments/:shipmentId/post')
  @HttpCode(200)
  @HttpCommand('fulfillment.shipment.post')
  @ApiOkResponse({ type: ShipmentDto })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  post(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('shipmentId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() r: Response,
  ) {
    requireEmptyCommand(body);
    return this.mutateShipment(p, s, id, 'post', undefined, r);
  }
  /** Отмена draft с причиной не отменяет заказ и не меняет reserve. */
  @Post('shipments/:shipmentId/cancel')
  @HttpCode(200)
  @HttpCommand('fulfillment.shipment.cancel')
  @ApiOkResponse({ type: ShipmentDto })
  cancel(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('shipmentId', new ParseUUIDPipe()) id: string,
    @Body() body: ReasonDto,
    @Res() r: Response,
  ) {
    return this.mutateShipment(p, s, id, 'cancel', body.reasonCode, r);
  }
  /** Подтверждает уже выполненный человеком полный возврат staged остатка, без DB locks на время физического действия. */
  @Post('orders/:orderId/cancellation-return')
  @HttpCode(200)
  @HttpCommand('fulfillment.order.cancellation-return')
  @ApiOkResponse({ type: OrderDto })
  async completeReturn(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: CancellationReturnDto,
    @Res() r: Response,
  ) {
    id = id.toLowerCase();
    const normalized = {
      reasonCode: body.reasonCode,
      lines: body.lines
        .map((l) => ({
          lineId: l.lineId.toLowerCase(),
          quantity: l.quantity,
          targetLocationId: l.targetLocationId.toLowerCase(),
        }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId)),
    };
    if (new Set(normalized.lines.map((l) => l.lineId)).size !== normalized.lines.length)
      throw new CommandError('VALIDATION_FAILED');
    const result = await this.commands.execute(
      s,
      { orderId: id, ...normalized },
      async (c) => {
        await this.shipping.completeCancellationReturn(c, id, normalized, {
          ...s,
          reasonCode: normalized.reasonCode,
        });
        return { statusCode: 200, body: await this.orders.read(c, id) };
      },
      async (c) => this.access.requireWarehouse(c, p, await this.orders.warehouse(c, id), 'return'),
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
  /** Общий transport path: policy по сохранённому заказу до cache, сервис затем получает order/header locks. */
  private async mutateShipment(
    p: Principal,
    s: CommandScope,
    id: string,
    action: 'post' | 'cancel',
    reason: string | undefined,
    r: Response,
  ) {
    id = id.toLowerCase();
    const result = await this.commands.execute(
      s,
      { shipmentId: id, action, ...(reason ? { reasonCode: reason } : {}) },
      async (c) => ({
        statusCode: 200,
        body:
          action === 'post'
            ? await this.shipping.postShipment(c, id, { ...s, reasonCode: 'shipment-posted' })
            : await this.shipping.cancelShipmentDraft(c, id, reason!, {
                ...s,
                reasonCode: reason!,
              }),
      }),
      async (c) => {
        const { warehouseId } = await this.shipping.findShipmentWarehouse(c, id);
        await this.access.requireWarehouse(c, p, warehouseId, 'ship');
      },
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
}
