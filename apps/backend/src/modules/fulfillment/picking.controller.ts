/** @file HTTP сборки: policy и допуск исполнителя до saved replay; все эффекты — в context HttpCommandsService. */
import { PickingTaskDto } from './dto/picking-task.dto';
import { Controller, Post, Get, Body, Param, ParseUUIDPipe, Res, HttpCode } from '@nestjs/common';
import {
  ApiTags,
  ApiCookieAuth,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PickingService } from './services/picking.service';
import { FulfillmentService } from './services/fulfillment.service';
import { AccessService } from '../identity/services/access.service';
import { Principal } from '../identity/dto/principal.dto';
import { IdentityAccess, SessionPrincipal } from '../identity/identity.http';
import { HttpCommand, CommandContext } from '../../infrastructure/http/http-command.decorator';
import { HttpCommandsService } from '../../infrastructure/idempotency/services/http-commands.service';
import { CommandScope } from '../../shared/operations/dto/command-scope.dto';
import { requireEmptyCommand } from '../../shared/validation/empty-command';
import { CommandError } from '../../shared/errors/command-error';
import { ConfirmPickingDto } from './dto/confirm-picking.dto';
/** Менеджер создаёт план; кладовщик сам принимает и подтверждает его. */
@Controller()
@ApiTags('picking')
@ApiCookieAuth('session')
@IdentityAccess('business')
export class PickingController {
  /** Внедряет сервисы владельцев и внутренний repository; создание экземпляра не выполняет I/O. */
  constructor(
    private readonly picking: PickingService,
    private readonly orders: FulfillmentService,
    private readonly access: AccessService,
    private readonly commands: HttpCommandsService,
  ) {}
  /** Текущий снимок доступен только читателю фактического склада задания. */
  @Get('picking-tasks/:taskId')
  @ApiOkResponse({ type: PickingTaskDto })
  read(@SessionPrincipal() p: Principal, @Param('taskId', new ParseUUIDPipe()) id: string) {
    return this.access.run(async (c) => {
      const { warehouseId } = await this.picking.findTaskWarehouse(c, id);
      await this.access.requireWarehouse(c, p, warehouseId, 'read');
      return this.picking.readTask(c, id, true);
    });
  }
  /** Создаёт план из текущего резерва без client actor/assignee. */
  @ApiCreatedResponse({ type: PickingTaskDto })
  @Post('orders/:orderId/picking-tasks')
  @HttpCommand('fulfillment.picking.create')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  async create(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() r: Response,
  ) {
    requireEmptyCommand(body);
    id = id.toLowerCase();
    const result = await this.commands.execute(
      s,
      { orderId: id },
      async (c) => ({
        statusCode: 201,
        body: await this.picking.createTaskFromOrder(c, id, {
          ...s,
          reasonCode: 'picking-created',
        }),
      }),
      async (c) => this.access.requireWarehouse(c, p, await this.orders.warehouse(c, id), 'order'),
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
  /** ready/shortage → in_progress; повтор терминального действия с новым ключом отклоняется. */
  @ApiOkResponse({ type: PickingTaskDto })
  @Post('picking-tasks/:taskId/start')
  @HttpCode(200)
  @HttpCommand('fulfillment.picking.start')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  start(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('taskId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() r: Response,
  ) {
    requireEmptyCommand(body);
    return this.execute(p, s, id, 'start', undefined, r);
  }
  /** Положительное перемещение либо сообщение о нехватке; фактический исполнитель определяется Principal. */
  @ApiOkResponse({ type: PickingTaskDto })
  @Post('picking-tasks/:taskId/confirm')
  @HttpCode(200)
  @HttpCommand('fulfillment.picking.confirm')
  confirm(
    @SessionPrincipal() p: Principal,
    @CommandContext() s: CommandScope,
    @Param('taskId', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmPickingDto,
    @Res() r: Response,
  ) {
    const normalized = {
      actualQuantity: body.actualQuantity,
      shortage: body.shortage,
      taskLineId: body.taskLineId.toLowerCase(),
      ...(body.targetLocationId ? { targetLocationId: body.targetLocationId.toLowerCase() } : {}),
    };
    return this.execute(p, s, id, 'confirm', normalized, r);
  }
  /** Проверяет текущие права и закрепление до cache; затем сервис сериализует сценарий order/task locks. */
  private async execute(
    p: Principal,
    s: CommandScope,
    id: string,
    action: 'start' | 'confirm',
    body: ConfirmPickingDto | undefined,
    r: Response,
  ) {
    id = id.toLowerCase();
    const result = await this.commands.execute(
      s,
      { taskId: id, action, body: body ?? {} },
      async (c) => ({
        statusCode: 200,
        body:
          action === 'start'
            ? await this.picking.startTask(c, id, p.userId, { ...s, reasonCode: 'picking-started' })
            : await this.picking.confirmPickedQuantity(c, id, p.userId, body!, {
                ...s,
                reasonCode: 'picking-confirmed',
              }),
      }),
      async (c) => {
        const { warehouseId, task } = await this.picking.findTaskWarehouse(c, id);
        await this.access.requireWarehouse(c, p, warehouseId, 'pick');
        if (task.assignee_id && task.assignee_id !== p.userId) throw new CommandError('FORBIDDEN');
      },
    );
    if (!r.destroyed) r.status(result.statusCode).json(result.body);
  }
}
