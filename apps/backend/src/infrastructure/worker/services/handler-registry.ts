/** @file Явная регистрация DB handlers; WMS-110 подключает настоящий inventory.putaway consumer без автоматического no-op. */
import { Inject, Injectable } from '@nestjs/common';
import type { LocalEventHandler } from '../dto/delivery.dto';
import { PUTAWAY_DESTINATION } from '../../outbox/outbox-destinations';
/** Composition root предоставляет реализации; тесты передают только свои disposable DB handlers. */
export const WORKER_HANDLERS = Symbol('WORKER_HANDLERS');
/** Не сканирует filesystem и не включает consumer автоматически по одному факту существования delivery. */
@Injectable()
export class HandlerRegistry {
  private readonly handlers = new Map<string, LocalEventHandler>();
  /** Проверяет stable destination и уникальность до старта poll; новый destination требует migration/replay плана. */
  constructor(@Inject(WORKER_HANDLERS) handlers: readonly LocalEventHandler[]) {
    for (const handler of handlers) {
      if (handler.destination !== PUTAWAY_DESTINATION || this.handlers.has(handler.destination))
        throw new Error('Invalid worker handler registration');
      this.handlers.set(handler.destination, handler);
    }
  }
  /** Список только реально подключённых handlers; пустой список означает отсутствие claim, а не no-op ack. */
  destinations(): string[] {
    return [...this.handlers.keys()];
  }
  /** Lookup по проверенному claim; undefined не считается успешной обработкой. */
  get(destination: string): LocalEventHandler | undefined {
    return this.handlers.get(destination);
  }
}
