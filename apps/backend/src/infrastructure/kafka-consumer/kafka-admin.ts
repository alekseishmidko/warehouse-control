/** @file Local Kafka recovery CLI: explicit opt-in/admin role, safe stdout и audited raw export в новый private file. */
import '../logging/startup';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { openSync, writeFileSync, closeSync, constants, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { loadEnvironment } from '../config/environment';
import { requireLocalRecovery } from '../outbox/recovery-options';
import { KafkaConsumerModule } from './kafka-consumer.module';
import { KafkaRecoveryService } from './services/kafka-recovery.service';
import { logEvent, nestLogger } from '../logging/runtime-logger';
/** Только явные именованные флаги; output file никогда не подменяет quarantine/source record. */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const flags = new Map<string, string>();
  if (!['inspect', 'retry', 'export', 'cleanup'].includes(command) || args.length % 2)
    throw new Error('Invalid Kafka recovery arguments');
  const allowed =
    command === 'inspect'
      ? ['--id']
      : command === 'export'
        ? ['--id', '--operator', '--reason', '--output']
        : ['--id', '--operator', '--reason'];
  for (let i = 0; i < args.length; i += 2) {
    if (
      !allowed.includes(args[i]) ||
      flags.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new Error('Invalid Kafka recovery arguments');
    flags.set(args[i], args[i + 1]);
  }
  if (flags.size !== allowed.length) throw new Error('Invalid Kafka recovery arguments');
  const config = loadEnvironment();
  requireLocalRecovery(config, process.env);
  const timer = setTimeout(() => {
    logEvent('process.failed');
    process.exit(1);
  }, 15000);
  const app = await NestFactory.createApplicationContext(KafkaConsumerModule, {
    logger: nestLogger,
    abortOnError: false,
  });
  let fd: number | undefined;
  try {
    const recovery = app.get(KafkaRecoveryService);
    const input = {
      id: flags.get('--id')!,
      operatorId: flags.get('--operator')!,
      reasonCode: flags.get('--reason')!,
      correlationId: randomUUID(),
    };
    let result: unknown;
    if (command === 'inspect') result = await recovery.inspect(input.id);
    else if (command === 'retry') result = await recovery.retry(input);
    else if (command === 'cleanup') result = await recovery.cleanup(input);
    else {
      // Canonical parent запрещает symlink в компонентах пути; O_EXCL/O_NOFOLLOW защищают leaf.
      const target = resolve(flags.get('--output')!);
      if (realpathSync(dirname(target)) !== dirname(target)) throw new Error('Unsafe export path');
      fd = openSync(
        target,
        constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
        0o600,
      );
      const raw = await recovery.exportRaw(input);
      writeFileSync(fd, raw);
      result = { id: input.id, status: 'exported' };
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    if (fd !== undefined) closeSync(fd);
    await app.close();
    clearTimeout(timer);
  }
}
if (require.main === module)
  void main().catch(() => {
    logEvent('process.failed');
    process.exitCode = 1;
  });
