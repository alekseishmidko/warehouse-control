/** @file Явные test-only identity fixtures: настоящие SQL session/grants, без dev-actor fallback и без копии авторизации. */
import type { INestApplication } from '@nestjs/common';
import type { Test } from 'supertest';
import { randomUUID } from 'node:crypto';
import { AccessService } from '@backend/modules/identity/services/access.service';
import { newSecret, secretHash, sessionCsrf } from '@backend/shared/security/secrets';
import { DUMMY_PASSWORD_HASH } from '@backend/shared/security/password';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { sql } from 'drizzle-orm';
/** Синтетическая capability для request helper, только disposable БД. Dummy password не используется для login tests. */
export interface TestIdentity {
  userId: string;
  sessionId: string;
  cookie: string;
  csrfToken: string;
}
/** Создаёт существующие session/users напрямую как fixture, реальные auth guards/ACL не подменяются. */
export async function identityFixture(
  app: INestApplication,
  options: {
    userId?: string;
    warehouseId?: string;
    role?: string;
    admin?: boolean;
    passwordHash?: string;
  } = {},
): Promise<TestIdentity> {
  const access = app.get(AccessService);
  const userId = options.userId ?? randomUUID();
  const sessionId = randomUUID();
  const token = newSecret();
  await access.run(async (context) => {
    const tx = transactionClient(context);
    await tx.execute(
      sql`insert into users(id,login,password_hash,system_admin) values(${userId},${`test-${userId}`},${options.passwordHash ?? DUMMY_PASSWORD_HASH},${options.admin ?? false}) on conflict(id) do nothing`,
    );
    await tx.execute(sql`insert into sessions(id,user_id,token_hash,absolute_expires_at,idle_expires_at)
      values(${sessionId},${userId},${secretHash(token)},clock_timestamp()+interval '1 hour',clock_timestamp()+interval '30 minutes')`);
    if (options.warehouseId)
      await tx.execute(
        sql`insert into warehouse_roles(user_id,warehouse_id,role) values(${userId},${options.warehouseId},${options.role ?? 'warehouse_operator'}) on conflict do nothing`,
      );
  });
  return { userId, sessionId, cookie: `wms_session=${token}`, csrfToken: sessionCsrf(token) };
}
/** Прикрепляет browser-контекст к Supertest request; actual guard проверяет cookie, Origin и CSRF. */
export function withIdentity(request: Test, actor: TestIdentity): Test {
  return request
    .set('Cookie', actor.cookie)
    .set('Origin', 'http://127.0.0.1:3000')
    .set('X-CSRF-Token', actor.csrfToken);
}
