/** @file Только тестовый HTTP controller: реальная validation/guard/idempotency + metadata/audit/outbox, не production endpoint. */
import { Body, Controller, Injectable, Post, Res } from '@nestjs/common';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { CommandContext, HttpCommand } from '@backend/infrastructure/http/http-command.decorator';
import type { CommandScope } from '@backend/shared/operations/dto/command-scope.dto';
import { HttpCommandsService } from '@backend/infrastructure/idempotency/services/http-commands.service';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { applicationMetadata } from '@backend/infrastructure/database/schema';
import { AuditService } from '@backend/modules/audit/services/audit.service';
import { OutboxService } from '@backend/infrastructure/outbox/services/outbox.service';
import { outboxFixture } from './outbox.fixture';

/** Входные поля ограничены; числа не приводятся из strings, неизвестные поля запрещены global pipe. */
export class ProbeCommandDto {
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsInt() @Min(1) @Max(100) quantity!: number;
}
/** Test-only gates/counters для наблюдения настоящей транзакции, без подмены production providers. */
@Injectable()
export class CommandProbe {
  /** Считаются только реальные work callbacks; replay должен оставить счётчик прежним. */
  calls = 0;
  /** Одноразовая ошибка после DB writes: проверяется rollback сразу всех владельцев данных. */
  fail = false;
  /** Чистый Promise barrier удерживает transaction без внешнего I/O, пока тест наблюдает lock/timeout. */
  wait?: Promise<void>;
  /** Сигнал тесту после бизнес/audit/outbox INSERT, но ещё до callback завершения/commit. */
  started?: () => void;
}
/** Регистрируется только через options test harness; AppModule и generated production OpenAPI его не импортируют. */
@Controller('commands')
export class ProbeCommandController {
  /** Использует настоящие production services; probe управляет только моментом/сбоем test callback. */
  constructor(private readonly commands: HttpCommandsService, private readonly probe: CommandProbe,
    private readonly audit: AuditService, private readonly outbox: OutboxService) {}
  @Post()
  @HttpCommand('test.create')
  /**
   * Демонстрирует controller boundary: нормализует validated DTO, передаёт trusted scope,
   * вызывает владельца transaction и отправляет result после commit. В production отсутствует.
   * Не создаёт новый context для audit/outbox и не пишет ответ внутри transaction callback.
   */
  async create(@CommandContext() scope: CommandScope, @Body() body: ProbeCommandDto, @Res() response: Response): Promise<void> {
    // Semantic normalization находится у владельца команды, canonicalJson позже сортирует только keys.
    const normalized = { name: body.name.trim(), quantity: body.quantity };
    // Source fixture и target IDs готовятся до callback: внутри нет файлового I/O.
    const event = outboxFixture({ correlationId: scope.correlationId });
    const result = await this.commands.execute(scope, { body: normalized }, async context => {
      this.probe.calls++;
      const fail = this.probe.fail; this.probe.fail = false; // Fault инъецируется ровно в один callback.
      const id = randomUUID();
      await transactionClient(context).insert(applicationMetadata).values({ key: id, value: normalized.name });
      await this.audit.write(context, { actorType: scope.actorType, actorId: scope.actorId, correlationId: scope.correlationId,
        action: 'test-created', entityType: 'test-command', entityId: id, reasonCode: 'integration-test' });
      await this.outbox.append(context, event);
      this.probe.started?.();
      if (this.probe.wait) await this.probe.wait;
      if (fail) throw new Error('private-driver-secret');
      return { statusCode: 201, body: { id, ...normalized }, headers: { location: `/api/v1/commands/${id}` } };
    });
    // HTTP timeout уже мог закрыть клиентское соединение, но это не отменяет сохранённый DB result.
    if (response.destroyed) return;
    for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
    response.status(result.statusCode).json(result.body);
  }
}
