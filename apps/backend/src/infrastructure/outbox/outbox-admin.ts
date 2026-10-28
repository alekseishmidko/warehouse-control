/** @file Локальные команды inspect/retry/signal: аргументы и явное разрешение проверяются до БД.
 * Результат выводится одним JSON; HTTP, worker и миграции этим executable не запускаются. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { loadEnvironment } from '../config/environment';
import { OutboxModule } from './outbox.module';
import { OutboxRecoveryService } from './services/outbox-recovery.service';
import { parseRecoveryOptions, requireLocalRecovery } from './recovery-options';
import { RecoveryError } from './dto/recovery.dto';
/** Владеет жизненным циклом Nest-контекста и закрывает пул даже при отказе команды.
 * @returns После вывода безопасного JSON и попытки закрытия ресурсов; результат отражён в process.exitCode.
 * Коды: 0 — успех, 2 — локальный alert, 1 — отказ, неправильный ввод или ошибка БД/закрытия.
 * Общий предел 15 секунд включает запуск и закрытие; при его превышении процесс завершается принудительно. */
async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    // Новый UUID относится к вмешательству, а не к исходной корреляции события.
    const options = parseRecoveryOptions(process.argv.slice(2), randomUUID());
    const config = loadEnvironment(); requireLocalRecovery(config, process.env);
    // Таймер ограничивает весь CLI, включая запуск Nest и app.close; SQL дополнительно ограничен сервисом.
    timer = setTimeout(() => { console.error(JSON.stringify({ code: 'ADMIN_DEADLINE_EXCEEDED' })); process.exit(1); }, 15000);
    app = await NestFactory.createApplicationContext(OutboxModule, { logger: false, abortOnError: false });
    const service = app.get(OutboxRecoveryService);
    const result = options.command === 'inspect' ? await service.inspect(options.address, options.payload)
      : options.command === 'retry' ? await service.retry(options.input) : await service.signal(options.thresholds);
    // Результат сервиса уже получен после завершения транзакции. Выводим только разрешённые поля;
    // ошибка stdout не отменяет состоявшийся commit. После неё оператор должен выполнить inspect.
    console.log(JSON.stringify(result));
    if (options.command === 'signal' && 'status' in result && result.status === 'alert') process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ code: error instanceof RecoveryError ? error.code : 'ADMIN_COMMAND_FAILED' })); process.exitCode = 1;
  } finally {
    // Сначала закрываем пул, затем снимаем общий таймер: зависание cleanup тоже имеет предел.
    try { await app?.close(); } catch { console.error(JSON.stringify({ code: 'ADMIN_CLEANUP_FAILED' })); process.exitCode = 1; }
    if (timer) clearTimeout(timer);
  }
}
if (require.main === module) void main();
