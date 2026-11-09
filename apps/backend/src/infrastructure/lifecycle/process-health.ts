/** @file Минимальный probe listener worker: состояние процесса отдельно от доступности PostgreSQL. */
import { createServer, type Server } from 'node:http';
/** Probe state не является бизнес-readiness отдельной команды или гарантией commit. */
export class ProcessHealth {
  started = false;
  draining = false;
  /** Nest вызывает после module init; worker с ручным listener выставляет тот же флаг после bind. */
  onApplicationBootstrap(): void {
    this.started = true;
  }
  /** DB check не нужен для liveness: outage не должен вызывать бесконечные restarts. */
  constructor(private readonly databaseReady: () => Promise<void>) {}
  /** Закрытый набор probe путей; отказ не раскрывает исходную ошибку драйвера. */
  async status(path: string): Promise<number> {
    if (path === '/health/live' || path === '/health') return 200;
    if (path === '/health/startup') return this.started ? 200 : 503;
    if (path !== '/health/ready') return 404;
    if (!this.started || this.draining) return 503;
    try {
      await this.databaseReady();
      return this.draining ? 503 : 200;
    } catch {
      return 503;
    }
  }
  /** Worker публикует только GET probes; warehouse routes на этом listener отсутствуют. */
  async listen(port: number): Promise<Server> {
    const server = createServer((request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405).end();
        return;
      }
      this.status(request.url ?? '')
        .then((code) => {
          response.setHeader('Cache-Control', 'no-store');
          response.writeHead(code).end();
        })
        .catch(() => response.writeHead(503).end());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    return server;
  }
}
