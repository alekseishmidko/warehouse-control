/** @file Технические маршруты приветствия и ответа процесса; без доступа к БД. */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/** HTTP-адаптер каркаса; складские операции размещаются в отдельных модулях. */
@Controller()
export class AppController {
  /** Получает сервис приветствия через Nest DI. */
  constructor(private readonly appService: AppService) {}

  /** GET /: возвращает текстовое имя API без изменения состояния. */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** GET /health: подтверждает ответ процесса, но не готовность БД или очереди. */
  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
