/** @file HTTP adapter приёмки: guard → DTO/normalization → transactional commands → безопасный JSON result. */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CommandContext, HttpCommand } from '../../infrastructure/http/http-command.decorator';
import { HttpCommandsService } from '../../infrastructure/idempotency/services/http-commands.service';
import type { CommandScope, CommandResult } from '../../shared/operations/dto/command-scope.dto';
import { CommandError } from '../../shared/errors/command-error';
import { CreateReceiptDto, ReceiptDto } from './dto/receipt.dto';
import { ReceivingService } from './services/receiving.service';

/** Все routes закрыты DevActorGuard; в production остаются недоступны до реальной authentication. */
@ApiTags('receiving')
@Controller('receipts')
export class ReceivingController {
  /** DI передаёт публичные сервисы; controller не вызывает SQL и не владеет pool. */
  constructor(private readonly receiving: ReceivingService, private readonly commands: HttpCommandsService) {}

  /** Создаёт draft; hash включает только нормализованный body, identity уже проверена guard на каждой попытке. */
  @Post() @HttpCommand('receiving.create')
  @ApiOperation({ summary: 'Создать draft (только изолированный dev/test actor)' })
  @ApiCreatedResponse({ type: ReceiptDto, headers: { Location: { schema: { type: 'string' }, description: 'Относительный URL документа.' } } })
  async create(@CommandContext() scope: CommandScope, @Body() body: CreateReceiptDto, @Res() response: Response): Promise<void> {
    const normalized = this.receiving.normalize(body);
    const result = await this.commands.execute(scope, { body: normalized }, async context => {
      const document = await this.receiving.create(context, normalized, { ...scope, reasonCode: 'receipt-created' });
      return { statusCode: 201, body: document, headers: { location: `/api/v1/receipts/${document.id}` } };
    });
    this.send(response, result);
  }

  /** Проводит с общим command context; body отсутствует/{} и не может содержать actor, quantity или status. */
  @Post(':receiptId/post') @HttpCommand('receiving.post')
  @ApiOperation({ summary: 'Провести draft; posted с новым ключом → RECEIPT_ALREADY_POSTED' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiBody({ required: false, schema: { type: 'object', properties: {}, additionalProperties: false } })
  @ApiOkResponse({ type: ReceiptDto })
  @ApiResponse({ status: 404, description: 'RECEIPT_NOT_FOUND', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } })
  async post(@CommandContext() scope: CommandScope, @Param('receiptId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown, @Res() response: Response): Promise<void> {
    // Пустая команда не нуждается в фиктивных полях DTO. Явно проверяем пустой JSON
    // object: лишние поля нельзя молча игнорировать при формировании fingerprint.
    if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) throw new CommandError('VALIDATION_FAILED');
    const receiptId = id.toLowerCase();
    const result = await this.commands.execute(scope, { target: { receiptId }, body: {} }, async context => ({
      statusCode: 200, body: await this.receiving.post(context, receiptId, { ...scope, reasonCode: 'receipt-posted' }),
    }));
    this.send(response, result);
  }

  /** Читает текущее состояние после того же actor guard; Idempotency-Key для GET не требуется. */
  @Get(':receiptId') @ApiOperation({ summary: 'Прочитать документ (только изолированный dev/test actor)' })
  @ApiParam({ name: 'receiptId', format: 'uuid' }) @ApiOkResponse({ type: ReceiptDto })
  @ApiResponse({ status: 403, description: 'DEV_ACTOR_UNAVAILABLE', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } })
  get(@Param('receiptId', new ParseUUIDPipe()) id: string): Promise<ReceiptDto> { return this.receiving.get(id); }

  /** Отправляет только уже committed status/body/Location; correlation header принадлежит текущему request. */
  private send(response: Response, result: CommandResult): void {
    if (response.destroyed) return;
    if (result.headers?.location) response.setHeader('Location', result.headers.location);
    response.status(result.statusCode).json(result.body);
  }
}
