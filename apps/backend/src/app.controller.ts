/** @file Технические маршруты приветствия и ответа процесса; без доступа к БД. */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOkResponse } from '@nestjs/swagger';
import { TechnicalRoute } from './infrastructure/http/http-command.decorator';

/** HTTP-адаптер каркаса; складские операции размещаются в отдельных модулях. */
@Controller()
@TechnicalRoute()
export class AppController {
  /** Получает сервис приветствия через Nest DI. */
  constructor(private readonly appService: AppService) {}

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
}
