/** @file HTTP adapter приёмки: guard → DTO/normalization → transactional commands → безопасный JSON result. */
import { AccessService } from '../identity/services/access.service';
import { IdentityAccess, SessionPrincipal } from '../identity/identity.http';
import type { Principal } from '../identity/dto/principal.dto';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CommandContext, HttpCommand } from '../../infrastructure/http/http-command.decorator';
import { HttpCommandsService } from '../../infrastructure/idempotency/services/http-commands.service';
import type { CommandScope, CommandResult } from '../../shared/operations/dto/command-scope.dto';
import { CommandError } from '../../shared/errors/command-error';
import { CreateReceiptDto, ReceiptDto } from './dto/receipt.dto';
import { ReceivingService } from './services/receiving.service';

/** Все routes требуют AuthGuard и warehouse policy; server actor не выбирается клиентом. */
@IdentityAccess('business')
@ApiTags('receiving')
@Controller('receipts')
export class ReceivingController {
  /** DI передаёт публичные сервисы; controller не вызывает SQL и не владеет pool. */
  constructor(
    private readonly receiving: ReceivingService,
    private readonly commands: HttpCommandsService,
    private readonly access: AccessService,
  ) {}

  /** Создаёт draft; hash включает только нормализованный body, identity уже проверена guard на каждой попытке. */
  @Post()
  @HttpCommand('receiving.create')
  @ApiOperation({ summary: 'Создать draft (сессия и роль склада)' })
  @ApiCreatedResponse({
    type: ReceiptDto,
    headers: {
      Location: { schema: { type: 'string' }, description: 'Относительный URL документа.' },
    },
  })
  async create(
    @SessionPrincipal() principal: Principal,
    @CommandContext() scope: CommandScope,
    @Body() body: CreateReceiptDto,
    @Res() response: Response,
  ): Promise<void> {
    const normalized = this.receiving.normalize(body);
    const result = await this.commands.execute(
      scope,
      { body: normalized },
      async (context) => {
        const document = await this.receiving.create(context, normalized, {
          ...scope,
          reasonCode: 'receipt-created',
        });
        return {
          statusCode: 201,
          body: document,
          headers: { location: `/api/v1/receipts/${document.id}` },
        };
      },
      (context) =>
        this.access.requireWarehouse(context, principal, normalized.warehouseId, 'receive'),
    );
    this.send(response, result);
  }

  /** Проводит с общим command context; body отсутствует/{} и не может содержать actor, quantity или status. */
  @Post(':receiptId/post')
  @HttpCommand('receiving.post')
  @ApiOperation({ summary: 'Провести draft; posted с новым ключом → RECEIPT_ALREADY_POSTED' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiBody({
    required: false,
    schema: { type: 'object', properties: {}, additionalProperties: false },
  })
  @ApiOkResponse({ type: ReceiptDto })
  @ApiResponse({
    status: 404,
    description: 'RECEIPT_NOT_FOUND',
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  })
  async post(
    @SessionPrincipal() principal: Principal,
    @CommandContext() scope: CommandScope,
    @Param('receiptId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    // Пустая команда не нуждается в фиктивных полях DTO. Явно проверяем пустой JSON
    // object: лишние поля нельзя молча игнорировать при формировании fingerprint.
    if (
      body !== undefined &&
      (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)
    )
      throw new CommandError('VALIDATION_FAILED');
    const receiptId = id.toLowerCase();
    const result = await this.commands.execute(
      scope,
      { target: { receiptId }, body: {} },
      async (context) => ({
        statusCode: 200,
        body: await this.receiving.post(context, receiptId, {
          ...scope,
          reasonCode: 'receipt-posted',
        }),
      }),
      async (context) => {
        const document = await this.receiving.read(context, receiptId);
        await this.access.requireWarehouse(context, principal, document.warehouseId, 'receive');
      },
    );
    this.send(response, result);
  }

  /** Читает текущее состояние после того же actor guard; Idempotency-Key для GET не требуется. */
  @Get(':receiptId')
  @ApiOperation({ summary: 'Прочитать документ (сессия и роль склада)' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiOkResponse({ type: ReceiptDto })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN',
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  })
  get(
    @SessionPrincipal() principal: Principal,
    @Param('receiptId', new ParseUUIDPipe()) id: string,
  ): Promise<ReceiptDto> {
    return this.access.run(async (context) => {
      // Склад определяем по сохранённому документу, не по произвольному warehouseId в query.
      const document = await this.receiving.read(context, id);
      await this.access.requireWarehouse(context, principal, document.warehouseId, 'read');
      return document;
    });
  }

  /** Отправляет только уже committed status/body/Location; correlation header принадлежит текущему request. */
  private send(response: Response, result: CommandResult): void {
    if (response.destroyed) return;
    if (result.headers?.location) response.setHeader('Location', result.headers.location);
    response.status(result.statusCode).json(result.body);
  }
}
