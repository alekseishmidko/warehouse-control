/**
 * @file Одноразовое создание первого system_admin через отдельную CLI-процедуру.
 *
 * Зачем это нужно: все HTTP-команды управления пользователями требуют уже существующего admin.
 * На пустой установке его ещё нет. Bootstrap решает только эту начальную задачу, не отключая
 * auth guards и не открывая публичную регистрацию. Миграция создаёт структуру, но не может
 * безопасно содержать общий пароль администратора или реальный пользовательский credential.
 *
 * Что делает: читает {login,password} из ограниченного stdin, проверяет явный локальный opt-in,
 * запускает UsersService.bootstrap, который под DB lock проверяет permission group, отсутствие
 * users и retained marker, затем одним commit пишет marker, первого admin и безопасный audit.
 * Password hash вычисляется до транзакции. В stdout выводятся только event/id/login.
 *
 * Когда использовать: один раз после build/migrations и настройки auth policy, командой
 * pnpm identity:bootstrap. IDENTITY_BOOTSTRAP_ENABLED=true задаётся только на этот вызов.
 * Пароль не передавать argv/env и не хранить в репозитории: CLI принимает JSON через stdin.
 * Допущены loopback DB URL либо development/test Docker host postgres, также нужна DB group
 * warehouse_identity_bootstrap (dev owner проходит). HTTP server здесь не создаётся.
 *
 * Чего не делает: не запускается автоматически при API startup, не сбрасывает существующий
 * пароль, не создаёт warehouse роли и не заменяет обычный admin API. После создания пользователей
 * повторный запуск запрещён; удаление marker ради повтора не является процедурой recovery.
 * System admin должен отдельно получить warehouse role, чтобы проводить складские операции.
 * Подробный пример безопасного ввода и flow: docs/flows/identity.md, раздел Bootstrap.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnvironment } from '../../infrastructure/config/environment';
import { IdentityModule } from './identity.module';
import { UsersService } from './services/users.service';
/** Не принимает пароль argv/env, не печатает raw errors; hard deadline включает закрытие пула. */
async function main(): Promise<void> {
  const config = loadEnvironment();
  if (
    process.argv.length !== 2 ||
    process.env.IDENTITY_BOOTSTRAP_ENABLED !== 'true' ||
    !(
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname) ||
      (['development', 'test'].includes(config.nodeEnv) &&
        new URL(config.databaseUrl).hostname === 'postgres')
    )
  )
    throw new Error('Bootstrap requires local opt-in');
  const deadline = setTimeout(() => process.exit(1), 30000);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    // Декодируем UTF-8 один раз: граница stream chunks может проходить внутри символа пароля.
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const data = Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 4096) throw new Error('Invalid bootstrap input');
      chunks.push(data);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'login,password' ||
      typeof value.login !== 'string' ||
      typeof value.password !== 'string'
    )
      throw new Error('Invalid bootstrap input');
    app = await NestFactory.createApplicationContext(IdentityModule, {
      logger: false,
      abortOnError: false,
    });
    const user = await app
      .get(UsersService)
      .bootstrap({ login: value.login, password: value.password });
    console.log(JSON.stringify({ event: 'identity.bootstrapped', ...user }));
  } finally {
    try {
      await app?.close();
    } finally {
      clearTimeout(deadline);
    }
  }
}
void main().catch(() => {
  console.error('Identity bootstrap failed; check opt-in, DB role, one-time state and input');
  process.exitCode = 1;
});
