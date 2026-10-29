/** @file HTTP размещения: trusted session/warehouse policy до dedup, затем inventory owner в общем command context. */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InventoryService } from './services/inventory.service';
import { AccessService } from '../identity/services/access.service';
import { IdentityAccess, SessionPrincipal } from '../identity/identity.http';
import type { Principal } from '../identity/dto/principal.dto';
import { CommandContext, HttpCommand } from '../../infrastructure/http/http-command.decorator';
import { HttpCommandsService } from '../../infrastructure/idempotency/services/http-commands.service';
import type { CommandScope } from '../../shared/operations/dto/command-scope.dto';
import { ExecutePutawayDto } from './dto/execute-putaway.dto';
import { PutawayTaskResponseDto } from './dto/putaway-task-response.dto';
/** Graph подключён только API, worker не импортирует этот HTTP adapter. */
@ApiTags('inventory-putaway')
@ApiCookieAuth('session')
@IdentityAccess('business')
@Controller('putaway-tasks')
export class InventoryController {
  /** Только публичные владельцы, без SQL/чужих repositories. */
  constructor(
    private readonly inventory: InventoryService,
    private readonly access: AccessService,
    private readonly commands: HttpCommandsService,
  ) {}
  /** Читает task и проверяет read на её фактическом складе в одной транзакции; 404/403 без утечки payload. */
  @Get(':taskId')
  @ApiOkResponse({ type: PutawayTaskResponseDto })
  @ApiResponse({ status: 404, description: 'PUTAWAY_TASK_NOT_FOUND' })
  async get(
    @SessionPrincipal() principal: Principal,
    @Param('taskId', new ParseUUIDPipe()) id: string,
  ): Promise<PutawayTaskResponseDto> {
    return this.access.run(async (context) => {
      const task = await this.inventory.readPutawayTask(context, id);
      await this.access.requireWarehouse(context, principal, task.warehouseId, 'read');
      return task;
    });
  }
  /** Выполняет целиком; прежний key даёт прежний результат, новый key на completed —409. Авторизация предшествует replay. */
  @Post(':taskId/execute')
  @HttpCommand('inventory.putaway.execute')
  @ApiOkResponse({ type: PutawayTaskResponseDto })
  @ApiResponse({ status: 404, description: 'PUTAWAY_TASK_NOT_FOUND' })
  async execute(
    @SessionPrincipal() principal: Principal,
    @CommandContext() scope: CommandScope,
    @Param('taskId', new ParseUUIDPipe()) id: string,
    @Body() body: ExecutePutawayDto,
    @Res() response: Response,
  ): Promise<void> {
    const taskId = id.toLowerCase();
    const targetLocationId = body.targetLocationId.toLowerCase();
    const result = await this.commands.execute(
      scope,
      { target: { taskId }, body: { targetLocationId } },
      async (context) => ({
        statusCode: 200,
        body: await this.inventory.executePutawayTask(context, taskId, targetLocationId, {
          ...scope,
          reasonCode: 'putaway-executed',
        }),
      }),
      async (context) => {
        const task = await this.inventory.readPutawayTask(context, taskId);
        await this.access.requireWarehouse(context, principal, task.warehouseId, 'putaway');
      },
    );
    // Disconnect не отменяет commit; повтор исходного key вернёт сохранённый JSON.
    if (!response.destroyed) response.status(result.statusCode).json(result.body);
  }
}
