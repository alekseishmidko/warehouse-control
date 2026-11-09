/** @file Технические маршруты приветствия и ответа процесса; без доступа к БД. */
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ProcessHealth } from './infrastructure/lifecycle/process-health';
import { AppService } from './app.service';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { TechnicalRoute } from './infrastructure/http/http-command.decorator';

/** HTTP-адаптер каркаса; складские операции размещаются в отдельных модулях. */
@Controller()
@TechnicalRoute()
export class AppController {
  /** Получает сервис приветствия через Nest DI. */
  constructor(
    private readonly appService: AppService,
    private readonly health: ProcessHealth,
  ) {}

  /** GET /: возвращает текстовое имя API без изменения состояния. */
  @Get()
  @ApiOkResponse({
    description: 'Имя технического API без бизнес-эффектов.',
    content: { 'text/plain': { schema: { type: 'string', example: 'Warehouse Controller API' } } },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  /** GET /health: подтверждает ответ процесса, но не готовность БД или очереди. */
  @Get('health')
  @ApiOkResponse({
    description: 'Liveness процесса, не readiness БД.',
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
  })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
  /** Startup подтверждает завершение init; зависимость от БД остаётся отдельной readiness. */
  @Get('health/startup')
  @ApiOkResponse({ description: 'Инициализация процесса завершена.' })
  @ApiServiceUnavailableResponse({ description: 'Инициализация ещё не завершена.' })
  async startup(@Res() response: Response): Promise<void> {
    response.status(await this.health.status('/health/startup')).end();
  }
  /** Liveness проверяет только работающий event loop, без обращения к внешним сервисам. */
  @Get('health/live')
  @ApiOkResponse({ description: 'Event loop отвечает; внешние сервисы не проверяются.' })
  live(@Res() response: Response): void {
    response.status(200).end();
  }
  /** Readiness закрывается при drain и при отказе PostgreSQL; внутренние ошибки не выдаются. */
  @Get('health/ready')
  @ApiOkResponse({ description: 'Процесс принимает работу, PostgreSQL доступен.' })
  @ApiServiceUnavailableResponse({ description: 'Drain или PostgreSQL недоступен.' })
  async ready(@Res() response: Response): Promise<void> {
    response.status(await this.health.status('/health/ready')).end();
  }
}
