/** @file Poll scheduler: batch parallelism ограничен pool, stop прерывает polling и ожидает активные handlers. */
import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { WORKER_CONFIG, WorkerConfig } from '../worker.config';
import { WorkerService } from './worker.service';
import { deliveryDiagnostic } from '../../../shared/diagnostics/delivery-diagnostic';
import { logDelivery } from '../delivery-logger';

/** Не стартует через lifecycle автоматически: entrypoint явно вызывает run, API не импортирует worker. */
@Injectable()
export class WorkerLoop {
  private readonly stopping = new AbortController();
  private running?: Promise<void>;
  /** DI не создаёт background timers; настройки получены из validated provider. */
  constructor(private readonly worker: WorkerService, @Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {}
  /** Идемпотентно запускает poll; возвращённый promise заканчивается после stop и drain, не fire-and-forget. */
  run(): Promise<void> { return this.running ??= this.poll(); }
  /** Синхронно запрещает следующий claim и прерывает только poll wait; активный DB handler завершает transaction. */
  stop(): void { this.stopping.abort(); }
  /** Один batch целиком awaited; rejected process/failure не роняет остальные independent streams. */
  private async poll(): Promise<void> {
    while (!this.stopping.signal.aborted) {
      try {
        const claims = await this.worker.claim();
        // Signal мог прийти пока короткий claim был в БД. Не запускаем новые handlers;
        // не начатые claims безопасно восстановятся после lease expiry.
        if (this.stopping.signal.aborted) break;
        const results = await Promise.allSettled(claims.map(claim => this.worker.process(claim)));
        // При отказе сохранить outcome связываем безопасную ошибку с конкретным claim по индексу.
        // allSettled уже дождался всего batch; чужие потоки не прерываются из-за одной ошибки.
        // Диагностика выполняется вне транзакций, исходный rejection/SQL cause не выводится.
        results.forEach((result, index) => {
          if (result.status === 'rejected') logDelivery('persistence-failed', deliveryDiagnostic({ ...claims[index], lastError: 'TRANSIENT_FAILURE' }));
        });
      } catch { console.error('Worker poll failed'); }
      // Не логируем exception/env/payload. Даже DB outage не создаёт busy retry loop.
      try { await delay(this.config.pollIntervalMs, undefined, { signal: this.stopping.signal }); }
      catch { if (!this.stopping.signal.aborted) throw new Error('Worker poll timer failed'); }
    }
  }
}
