/** @file Реальная PostgreSQL identity: HTTP login/logout/CSRF, роли склада, отзыв до replay и атомарный admin audit. */
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { identityFixture, withIdentity } from '../support/identity.fixture';
import { hashPassword } from '@backend/shared/security/password';
import { AccessService } from '@backend/modules/identity/services/access.service';
import { UsersService } from '@backend/modules/identity/services/users.service';
import { SessionsService } from '@backend/modules/identity/services/sessions.service';
import type { WarehouseAction } from '@backend/modules/identity/dto/warehouse-role.types';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
const database = useDatabaseSuite();
let app: INestApplication;
let hash: string;
const password = 'Synthetic-Password-2026!';
beforeAll(async () => {
  app = await database().createHttpApplication();
  hash = await hashPassword(password);
});
/** Login идёт через настоящий guard/DTO/service/scrypt, не через session fixture. */
const login = (name: string, secret = password) =>
  request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', 'http://127.0.0.1:3000')
    .set('X-CSRF-Protection', '1')
    .send({ login: name, password: secret });
/** Справочники создаются владельцами, stock не пишется; только identity fixture имеет прямой SQL test setup. */
const refs = () =>
  app
    .get<TransactionRunner>(TRANSACTION_RUNNER)
    .run((context) =>
      createDevWarehouseFixtures(context, app.get(CatalogService), app.get(WarehousesService)),
    );
/** Raw session token приходит только cookie; caller добавляет его в запрос, сервер не получает actor из body. */
function cookieOf(response: { headers: Record<string, unknown> }): string {
  return (response.headers['set-cookie'] as string[])[0].split(';')[0];
}

test('login/me/logout uses safe cookie; DB contains only hashes and revoked session cannot be reused', async () => {
  const actor = await identityFixture(app, { passwordHash: hash });
  const name = `test-${actor.userId}`;
  const entered = await login(name.toUpperCase()).expect(200);
  const cookie = cookieOf(entered);
  expect(entered.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(entered.headers['set-cookie'][0]).toContain('SameSite=Strict');
  expect(JSON.stringify(entered.body)).not.toContain(password);
  expect(entered.body).not.toHaveProperty('token');
  const raw = cookie.split('=')[1];
  const stored = await database().connection.pool.query('select token_hash from sessions');
  expect(JSON.stringify(stored.rows)).not.toContain(raw);
  const me = await request(app.getHttpServer())
    .get('/api/v1/auth/me')
    .set('Cookie', cookie)
    .expect(200);
  expect(me.headers['cache-control']).toBe('no-store');
  expect(me.body.user.id).toBe(actor.userId);
  expect(me.body.csrfToken).toBe(entered.body.csrfToken);
  await request(app.getHttpServer())
    .post('/api/v1/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', 'http://127.0.0.1:3000')
    .set('X-CSRF-Token', entered.body.csrfToken)
    .send({})
    .expect(204);
  await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
});

test('unknown, wrong and disabled credentials return same safe failure without credential logging', async () => {
  const actor = await identityFixture(app, { passwordHash: hash });
  const sink = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const unknown = await login('missing.user').expect(401);
    const wrong = await login(`test-${actor.userId}`, password + 'x').expect(401);
    await database().connection.pool.query('update users set active=false');
    const blocked = await login(`test-${actor.userId}`).expect(401);
    expect([unknown.body.code, wrong.body.code, blocked.body.code]).toEqual([
      'UNAUTHORIZED',
      'UNAUTHORIZED',
      'UNAUTHORIZED',
    ]);
    expect(JSON.stringify([unknown.body, wrong.body, blocked.body, sink.mock.calls])).not.toContain(
      password,
    );
    expect(unknown.headers['set-cookie']).toBeUndefined();
  } finally {
    sink.mockRestore();
  }
});

test.each(['absolute_expires_at', 'idle_expires_at', 'revoked_at'])(
  'session denial for %s and no plaintext leaks',
  async (field) => {
    const actor = await identityFixture(app);
    // Сохраняем CHECK deadline_order при искусственном переводе absolute в прошлое.
    await database().connection.pool.query(
      field === 'absolute_expires_at'
        ? "update sessions set idle_expires_at=clock_timestamp()-interval '2 minutes',absolute_expires_at=clock_timestamp()-interval '1 minute'"
        : `update sessions set ${field}=clock_timestamp()-interval '1 minute'`,
    );
    const result = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', actor.cookie)
      .expect(401);
    expect(JSON.stringify(result.body)).not.toContain(actor.cookie.split('=')[1]);
  },
);

test('login CSRF/origin and authenticated CSRF reject before any business effect; no dev actor header bypass', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ login: 'missing.user', password })
    .expect(403);
  const actor = await identityFixture(app);
  await request(app.getHttpServer())
    .post('/api/v1/receipts')
    .set('Cookie', actor.cookie)
    .send({})
    .expect(403);
  await withIdentity(request(app.getHttpServer()).post('/api/v1/receipts'), actor)
    .set('Origin', 'https://attacker.example')
    .send({})
    .expect(403);
  await request(app.getHttpServer())
    .post('/api/v1/receipts')
    .set('X-Actor-Id', actor.userId)
    .send({})
    .expect(401);
  expect(
    (await database().connection.pool.query('select count(*)::int n from http_idempotency')).rows[0]
      .n,
  ).toBe(0);
});

test('warehouse scoped roles protect create/read/post and replay after grants or session revoke', async () => {
  const a = await refs();
  const b = await refs();
  const actor = await identityFixture(app, { warehouseId: a.warehouse.id });
  await database().connection.pool.query("insert into warehouse_roles values($1,$2,'viewer')", [
    actor.userId,
    b.warehouse.id,
  ]);
  const body = (fixture: typeof a) => ({
    warehouseId: fixture.warehouse.id,
    receivingLocationId: fixture.receiving.id,
    lines: [{ productId: fixture.product.id, quantity: 10 }],
  });
  const key = randomUUID();
  const create = (fixture: typeof a, commandKey = randomUUID()) =>
    withIdentity(request(app.getHttpServer()).post('/api/v1/receipts'), actor)
      .set('Idempotency-Key', commandKey)
      .send(body(fixture));
  const receipt = (await create(a, key).expect(201)).body;
  await create(b).expect(403);
  // Создаём чужой receipt через его владельца, затем проверяем IDOR по реальному сохранённому warehouseId.
  const other = await identityFixture(app, { warehouseId: b.warehouse.id });
  const document = (
    await withIdentity(request(app.getHttpServer()).post('/api/v1/receipts'), other)
      .set('Idempotency-Key', randomUUID())
      .send(body(b))
      .expect(201)
  ).body;
  await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/receipts/${document.id}`),
    actor,
  ).expect(200);
  await withIdentity(
    request(app.getHttpServer()).post(`/api/v1/receipts/${document.id}/post`),
    actor,
  )
    .set('Idempotency-Key', randomUUID())
    .send({})
    .expect(403);
  await database().connection.pool.query('delete from warehouse_roles where user_id=$1', [
    actor.userId,
  ]);
  await create(a, key).expect(403); // Saved response не возвращается после отзыва доступа.
  await withIdentity(
    request(app.getHttpServer()).get(`/api/v1/receipts/${receipt.id}`),
    actor,
  ).expect(403);
  await database().connection.pool.query(
    'update sessions set revoked_at=clock_timestamp() where user_id=$1',
    [actor.userId],
  );
  await create(a, key).expect(401);
});

test('system admin is not warehouse operator; admin updates revoke sessions and prevent last-admin removal', async () => {
  const admin = await identityFixture(app, { admin: true });
  const target = await identityFixture(app);
  const warehouse = await refs();
  const update = (id: string, body: object) =>
    withIdentity(request(app.getHttpServer()).patch(`/api/v1/identity/users/${id}`), admin).send(
      body,
    );
  await withIdentity(request(app.getHttpServer()).post('/api/v1/receipts'), admin)
    .set('Idempotency-Key', randomUUID())
    .send({
      warehouseId: warehouse.warehouse.id,
      receivingLocationId: warehouse.receiving.id,
      lines: [{ productId: warehouse.product.id, quantity: 1 }],
    })
    .expect(403);
  await update(admin.userId, {}).expect(400);
  await update(admin.userId, { active: false }).expect(409);
  await withIdentity(
    request(app.getHttpServer()).patch(`/api/v1/identity/users/${admin.userId}`),
    target,
  )
    .send({ active: false })
    .expect(403);
  await update(target.userId, { active: false }).expect(200);
  await request(app.getHttpServer())
    .get('/api/v1/auth/me')
    .set('Cookie', target.cookie)
    .expect(401);
  expect(
    (
      await database().connection.pool.query(
        "select count(*)::int n from audit_entries where action='identity.user-updated'",
      )
    ).rows[0].n,
  ).toBe(1);
});

test('audit failure rolls back administrative grants; token/hash/password never enter changes', async () => {
  const admin = await identityFixture(app, { admin: true });
  const target = await identityFixture(app);
  const warehouse = await refs();
  const pool = database().connection.pool;
  // AFTER INSERT fault возникает после физического SQL изменения grants; общий runner обязан откатить его.
  await pool.query(
    "create function identity_fault() returns trigger language plpgsql as $$ begin raise exception 'fault'; end $$",
  );
  try {
    await pool.query(
      'create trigger identity_fault after insert on audit_entries for each row execute function identity_fault()',
    );
    try {
      await withIdentity(
        request(app.getHttpServer()).post(
          `/api/v1/identity/users/${target.userId}/warehouses/${warehouse.warehouse.id}/roles`,
        ),
        admin,
      )
        .send({ roles: ['viewer'] })
        .expect(500);
    } finally {
      await pool.query('drop trigger identity_fault on audit_entries');
    }
  } finally {
    await pool.query('drop function identity_fault()');
  }
  expect(
    (
      await pool.query('select count(*)::int n from warehouse_roles where user_id=$1', [
        target.userId,
      ])
    ).rows[0].n,
  ).toBe(0);
});

test('expired login window resets, over-limit denies before expensive hashing', async () => {
  // Не выполняем 10 дорогих scrypt: реальное DB окно подготавливается test-only SQL к границе.
  const { secretHash } = await import('@backend/shared/security/secrets');
  await database().connection.pool.query(
    "insert into auth_login_windows values($1,10,clock_timestamp()+interval '1 minute')",
    [`login:${secretHash('missing.user')}`],
  );
  await login('missing.user').expect(429);
  await database().connection.pool.query(
    "update auth_login_windows set reset_at=clock_timestamp()-interval '1 minute'",
  );
  await login('missing.user').expect(401);
});

test('compiled bootstrap requires opt-in/DB role, runs once and rejects public registration', async () => {
  /** Запускает отдельный настоящий CLI; пароль подаётся stdin, env/argv не содержат credentials пользователя. */
  const bootstrap = (enabled: boolean, restricted = false) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult) => {
      const child = execFile(
        process.execPath,
        [resolve('dist/modules/identity/bootstrap.js')],
        {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DEV_ACTOR_ENABLED: 'false',
            DATABASE_URL: restricted
              ? database().config.databaseUrl +
                '?options=' +
                encodeURIComponent('-c role=warehouse_app')
              : database().config.databaseUrl,
            IDENTITY_BOOTSTRAP_ENABLED: enabled ? 'true' : 'false',
            AUTH_ORIGIN: 'http://127.0.0.1:3000',
            AUTH_SESSION_ABSOLUTE_SECONDS: '600',
            AUTH_SESSION_IDLE_SECONDS: '300',
          },
          timeout: 15000,
        },
        (error, stdout, stderr) =>
          resolveResult({ code: error ? Number(error.code) : 0, stdout, stderr }),
      );
      child.stdin?.end(JSON.stringify({ login: 'initial.admin', password }));
    });
  expect((await bootstrap(false)).code).not.toBe(0);
  expect((await bootstrap(true, true)).code).not.toBe(0);
  const first = await bootstrap(true);
  expect(first.code).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    event: 'identity.bootstrapped',
    login: 'initial.admin',
  });
  expect((await bootstrap(true)).code).not.toBe(0);
  expect(first.stdout + first.stderr).not.toContain(password);
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ login: 'evil.admin', password, systemAdmin: true })
    .expect(404);
});

/** Реальный lock user связывает warehouse mutation с authorization до commit, а не только с прошлым guard snapshot. */
test('grant revoke waits for authorized transaction and subsequent request is forbidden', async () => {
  const { waitForDatabaseLock } = await import('../support/database-lock');
  const access = app.get(AccessService);
  const users = app.get(UsersService);
  const warehouse = await refs();
  const actor = await identityFixture(app, { warehouseId: warehouse.warehouse.id });
  const admin = await identityFixture(app, { admin: true });
  let unlock!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((r) => {
    unlock = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const owner = access.run(async (context) => {
    await access.requireWarehouse(
      context,
      { userId: actor.userId, sessionId: actor.sessionId },
      warehouse.warehouse.id,
      'receive',
    );
    entered();
    await held;
  });
  let revoked: Promise<unknown> | undefined;
  try {
    await started;
    revoked = users.setRoles(
      { userId: admin.userId, sessionId: admin.sessionId },
      actor.userId,
      warehouse.warehouse.id,
      [],
      randomUUID(),
    );
    await waitForDatabaseLock(database(), 'users');
    unlock();
    await Promise.all([owner, revoked]);
    await expect(
      access.run((context) =>
        access.requireWarehouse(
          context,
          { userId: actor.userId, sessionId: actor.sessionId },
          warehouse.warehouse.id,
          'receive',
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    unlock();
    await Promise.allSettled([owner, ...(revoked ? [revoked] : [])]);
  }
});

/** AFTER session INSERT имитирует storage failure: новый browser token не должен покинуть процесс. */
test('failed session persistence issues no cookie; password reset revokes all target sessions', async () => {
  const actor = await identityFixture(app, { passwordHash: hash });
  const admin = await identityFixture(app, { admin: true });
  const pool = database().connection.pool;
  await pool.query(
    "create function session_fault() returns trigger language plpgsql as $$ begin raise exception 'fault'; end $$",
  );
  try {
    await pool.query(
      'create trigger session_fault after insert on sessions for each row execute function session_fault()',
    );
    try {
      const failed = await login(`test-${actor.userId}`).expect(500);
      expect(failed.headers['set-cookie']).toBeUndefined();
    } finally {
      await pool.query('drop trigger session_fault on sessions');
    }
  } finally {
    await pool.query('drop function session_fault()');
  }
  const other = await identityFixture(app, { userId: actor.userId });
  const next = 'Changed-Synthetic-Password-2026!';
  const changed = await withIdentity(
    request(app.getHttpServer()).patch(`/api/v1/identity/users/${actor.userId}`),
    admin,
  )
    .send({ password: next })
    .expect(200);
  expect(JSON.stringify(changed.body)).not.toContain(next);
  expect(
    JSON.stringify((await pool.query('select changes from audit_entries')).rows),
  ).not.toContain(next);
  for (const token of [actor.cookie, other.cookie])
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', token).expect(401);
  await login(`test-${actor.userId}`, next).expect(200);
});

/** Concurrent demotions сериализованы advisory lock; запрещено оставить систему без действующего admin. */
test('concurrent admin removals preserve one active administrator', async () => {
  const a = await identityFixture(app, { admin: true });
  const b = await identityFixture(app, { admin: true });
  const responses = await Promise.all([
    withIdentity(request(app.getHttpServer()).patch(`/api/v1/identity/users/${b.userId}`), a).send({
      active: false,
    }),
    withIdentity(request(app.getHttpServer()).patch(`/api/v1/identity/users/${a.userId}`), b).send({
      active: false,
    }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  expect(
    (
      await database().connection.pool.query(
        'select count(*)::int n from users where active and system_admin',
      )
    ).rows[0].n,
  ).toBe(1);
});

/** Sliding touch использует минимум с absolute deadline; cookie-дубликаты не выбираются произвольно. */
test('idle refresh cannot extend absolute deadline and duplicate session cookies are refused', async () => {
  const actor = await identityFixture(app);
  await database().connection.pool.query(
    "update sessions set idle_expires_at=clock_timestamp()+interval '30 seconds',absolute_expires_at=clock_timestamp()+interval '60 seconds'",
  );
  await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', actor.cookie).expect(200);
  expect(
    (
      await database().connection.pool.query(
        'select idle_expires_at=absolute_expires_at as capped from sessions',
      )
    ).rows[0].capped,
  ).toBe(true);
  await request(app.getHttpServer())
    .get('/api/v1/auth/me')
    .set('Cookie', `${actor.cookie}; ${actor.cookie}`)
    .expect(401);
});

/** Пользователь создаётся только admin, с проверяемым hash и без plaintext response/audit; login UNIQUE регистронезависим после нормализации. */
test('admin creates user safely, duplicate login conflicts and explicit all-session revoke works', async () => {
  const admin = await identityFixture(app, { admin: true });
  const body = { login: 'New.Operator', password };
  const made = await withIdentity(
    request(app.getHttpServer()).post('/api/v1/identity/users'),
    admin,
  )
    .send(body)
    .expect(201);
  expect(made.body).toMatchObject({ login: 'new.operator', systemAdmin: false });
  expect(made.body).not.toHaveProperty('passwordHash');
  await withIdentity(request(app.getHttpServer()).post('/api/v1/identity/users'), admin)
    .send({ ...body, login: 'new.operator' })
    .expect(409);
  const entered = await login('new.operator').expect(200);
  const cookie = cookieOf(entered);
  await withIdentity(
    request(app.getHttpServer()).delete(`/api/v1/identity/users/${made.body.id}/sessions`),
    admin,
  )
    .send({})
    .expect(200);
  await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  expect(
    JSON.stringify(
      (await database().connection.pool.query('select changes from audit_entries')).rows,
    ),
  ).not.toContain(password);
});

/** Уже исчерпанный peer budget не создаёт новые строки для произвольных логинов. */
test('blocked peer cannot grow account throttle keys', async () => {
  const { secretHash } = await import('@backend/shared/security/secrets');
  // Supertest использует ::ffff:127.0.0.1 для default listener; первый запрос узнаёт фактический hash key.
  await login('missing.user').expect(401);
  await database().connection.pool.query(
    "update auth_login_windows set attempts=50 where key like 'peer:%'",
  );
  await login('another.random.user').expect(429);
  const rows = (
    await database().connection.pool.query(
      "select key from auth_login_windows where key like 'login:%'",
    )
  ).rows;
  expect(rows).toEqual([{ key: `login:${secretHash('missing.user')}` }]);
});

/** Срок истекает во время ожидания реального lock: проверка до ожидания не должна оживить session sliding touch. */
test('expiry is rechecked after obtaining row lock, not before the wait', async () => {
  const { waitForDatabaseLock } = await import('../support/database-lock');
  const actor = await identityFixture(app);
  const pool = database().connection.pool;
  const client = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await pool.query(
      "update sessions set idle_expires_at=clock_timestamp()+interval '2 seconds' where id=$1",
      [actor.sessionId],
    );
    await client.query('begin');
    await client.query('select id from sessions where id=$1 for share', [actor.sessionId]);
    pending = app.get(SessionsService).authenticate(actor.cookie.split('=')[1]);
    // Сразу подписываемся на reject, чтобы Jest не получил unhandled rejection до assertion.
    const result = pending.then(
      () => 'accepted',
      (error) => error.code,
    );
    await waitForDatabaseLock(database(), 'sessions');
    expect(
      (
        await pool.query(
          'select idle_expires_at>clock_timestamp() as live from sessions where id=$1',
          [actor.sessionId],
        )
      ).rows[0].live,
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await client.query('commit');
    expect(await result).toBe('UNAUTHORIZED');
    expect(
      (
        await pool.query(
          'select idle_expires_at<clock_timestamp() as expired from sessions where id=$1',
          [actor.sessionId],
        )
      ).rows[0].expired,
    ).toBe(true);
  } finally {
    await client.query('rollback');
    client.release();
    await Promise.allSettled(pending ? [pending] : []);
  }
});

/**
 * Fault после UsersService.updateUser → SessionsService.revoke проверяет общий borrowed context:
 * отказ audit обязан вернуть прежний password hash, живые сессии и отсутствие audit факта.
 * Это реальный AFTER INSERT trigger в disposable PostgreSQL, не mock методов новых сервисов.
 */
test('password update and delegated session revoke roll back together when audit fails', async () => {
  const admin = await identityFixture(app, { admin: true });
  const target = await identityFixture(app, { passwordHash: hash });
  const other = await identityFixture(app, { userId: target.userId });
  const pool = database().connection.pool;
  await pool.query(
    "create function identity_split_fault() returns trigger language plpgsql as $$ begin raise exception 'fault'; end $$",
  );
  try {
    await pool.query(
      'create trigger identity_split_fault after insert on audit_entries for each row execute function identity_split_fault()',
    );
    try {
      await withIdentity(
        request(app.getHttpServer()).patch(`/api/v1/identity/users/${target.userId}`),
        admin,
      )
        .send({ password: 'Replacement-Synthetic-Password-2026!' })
        .expect(500);
    } finally {
      await pool.query('drop trigger identity_split_fault on audit_entries');
    }
  } finally {
    await pool.query('drop function identity_split_fault()');
  }
  expect(
    (await pool.query('select password_hash from users where id=$1', [target.userId])).rows[0]
      .password_hash,
  ).toBe(hash);
  expect(
    (
      await pool.query(
        'select count(*)::int n from sessions where user_id=$1 and revoked_at is null',
        [target.userId],
      )
    ).rows[0].n,
  ).toBe(2);
  expect((await pool.query('select count(*)::int n from audit_entries')).rows[0].n).toBe(0);
  for (const session of [target, other]) {
    const response = await withIdentity(
      request(app.getHttpServer()).get('/api/v1/auth/me'),
      session,
    ).expect(200);
    expect(response.body.user).not.toHaveProperty('password_hash');
  }
});

/** Адресный отзыв не затрагивает другую session/другого user и оставляет безопасный audit без capability. */
test('admin single-session revoke is scoped to target user and session', async () => {
  const admin = await identityFixture(app, { admin: true });
  const target = await identityFixture(app);
  const second = await identityFixture(app, { userId: target.userId });
  const stranger = await identityFixture(app);
  const revoke = (sessionId: string) =>
    withIdentity(
      request(app.getHttpServer()).delete(
        `/api/v1/identity/users/${target.userId}/sessions/${sessionId}`,
      ),
      admin,
    ).send({});
  // Чужой sessionId не должен обойти userId predicate SQL даже у разрешённого оператора.
  await revoke(stranger.sessionId).expect(200);
  await withIdentity(request(app.getHttpServer()).get('/api/v1/auth/me'), stranger).expect(200);
  await revoke(target.sessionId).expect(200);
  await withIdentity(request(app.getHttpServer()).get('/api/v1/auth/me'), target).expect(401);
  await withIdentity(request(app.getHttpServer()).get('/api/v1/auth/me'), second).expect(200);
  const records = (
    await database().connection.pool.query(
      "select changes from audit_entries where action='identity.session-revoked' order by occurred_at",
    )
  ).rows;
  expect(records).toHaveLength(2);
  expect(JSON.stringify(records)).toContain(target.sessionId);
  expect(JSON.stringify(records)).not.toContain(target.cookie.split('=')[1]);
});

/** Полная замена [] удаляет ровно grants выбранного склада; удаление имеет отдельный audit reason. */
test('admin removes warehouse roles with audit while preserving another warehouse', async () => {
  const admin = await identityFixture(app, { admin: true });
  const a = await refs();
  const b = await refs();
  const target = await identityFixture(app, { warehouseId: a.warehouse.id });
  await database().connection.pool.query("insert into warehouse_roles values($1,$2,'viewer')", [
    target.userId,
    b.warehouse.id,
  ]);
  await withIdentity(
    request(app.getHttpServer()).post(
      `/api/v1/identity/users/${target.userId}/warehouses/${a.warehouse.id}/roles`,
    ),
    admin,
  )
    .send({ roles: [] })
    .expect(201);
  const result = await withIdentity(
    request(app.getHttpServer()).get('/api/v1/auth/me'),
    target,
  ).expect(200);
  expect(result.body.warehouseRoles).toEqual([{ warehouseId: b.warehouse.id, role: 'viewer' }]);
  const removed = (
    await database().connection.pool.query(
      "select reason_code,changes from audit_entries where action='identity.warehouse-role-removed'",
    )
  ).rows;
  expect(removed).toEqual([
    {
      reason_code: 'warehouse-operator-removed',
      changes: { warehouseId: { after: a.warehouse.id } },
    },
  ]);
});

/** Missing target должен давать 404 во всех admin сценариях без частичных rows/audit. */
test.each(['update', 'roles', 'revoke'])(
  'admin %s rejects absent user without mutations',
  async (operation) => {
    const admin = await identityFixture(app, { admin: true });
    const missing = randomUUID();
    if (operation === 'update')
      await withIdentity(
        request(app.getHttpServer()).patch(`/api/v1/identity/users/${missing}`),
        admin,
      )
        .send({ active: false })
        .expect(404);
    if (operation === 'roles')
      await withIdentity(
        request(app.getHttpServer()).post(
          `/api/v1/identity/users/${missing}/warehouses/${randomUUID()}/roles`,
        ),
        admin,
      )
        .send({ roles: [] })
        .expect(404);
    if (operation === 'revoke')
      await withIdentity(
        request(app.getHttpServer()).delete(`/api/v1/identity/users/${missing}/sessions`),
        admin,
      )
        .send({})
        .expect(404);
    expect(
      (await database().connection.pool.query('select count(*)::int n from audit_entries')).rows[0]
        .n,
    ).toBe(0);
  },
);

/** DTO errors должны завершаться до password hashing/session INSERT и не возвращать входной секрет. */
test.each([
  { login: 'x', password },
  { login: 'valid.user', password: 'short' },
  { login: 'valid.user', password, actorId: randomUUID() },
  { login: 'valid.user', password: 12 },
])('login rejects malformed dto %# with safe problem response', async (body) => {
  const result = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', 'http://127.0.0.1:3000')
    .set('X-CSRF-Protection', '1')
    .send(body)
    .expect(400);
  expect(result.headers['content-type']).toContain('application/problem+json');
  expect(result.headers['set-cookie']).toBeUndefined();
  expect(JSON.stringify(result.body)).not.toContain(password);
  expect(
    (await database().connection.pool.query('select count(*)::int n from sessions')).rows[0].n,
  ).toBe(0);
});

/** Failed logout после session UPDATE не должен сообщать 204/clear-cookie; старый token остаётся действующим. */
test('logout storage failure rolls back revoke and never clears browser cookie', async () => {
  const target = await identityFixture(app);
  const pool = database().connection.pool;
  // Fault только на revoke, иначе guard idle touch упал бы раньше проверяемого controller сценария.
  await pool.query(
    "create function logout_fault() returns trigger language plpgsql as $$ begin if new.revoked_at is not null then raise exception 'fault'; end if; return new; end $$",
  );
  try {
    await pool.query(
      'create trigger logout_fault after update on sessions for each row execute function logout_fault()',
    );
    try {
      const result = await withIdentity(
        request(app.getHttpServer()).post('/api/v1/auth/logout'),
        target,
      )
        .send({})
        .expect(500);
      expect(result.headers['set-cookie']).toBeUndefined();
    } finally {
      await pool.query('drop trigger logout_fault on sessions');
    }
  } finally {
    await pool.query('drop function logout_fault()');
  }
  await withIdentity(request(app.getHttpServer()).get('/api/v1/auth/me'), target).expect(200);
});

/** Матрица ADR-0019 проверяется через реальные grants/locks, включая действия будущих endpoints, без регистрации фиктивных routes. */
test.each([
  ['viewer', ['read']],
  ['warehouse_operator', ['read', 'receive', 'putaway', 'pick', 'ship', 'return']],
  ['order_manager', ['read', 'order', 'reserve', 'cancel', 'audit']],
  [
    'warehouse_supervisor',
    [
      'read',
      'receive',
      'putaway',
      'pick',
      'ship',
      'return',
      'order',
      'reserve',
      'cancel',
      'audit',
      'adjust',
    ],
  ],
] as const)(
  'warehouse role %s follows approved action matrix and cannot access another warehouse',
  async (role, allowed) => {
    const warehouse = await refs();
    const other = await refs();
    const actor = await identityFixture(app, { warehouseId: warehouse.warehouse.id, role });
    const access = app.get(AccessService);
    const principal = { userId: actor.userId, sessionId: actor.sessionId };
    const actions: WarehouseAction[] = [
      'read',
      'receive',
      'putaway',
      'pick',
      'ship',
      'return',
      'order',
      'reserve',
      'cancel',
      'audit',
      'adjust',
    ];
    for (const action of actions) {
      const attempt = access.run((context) =>
        access.requireWarehouse(context, principal, warehouse.warehouse.id, action),
      );
      if ((allowed as readonly string[]).includes(action))
        await expect(attempt).resolves.toBeUndefined();
      else await expect(attempt).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      access.run((context) =>
        access.requireWarehouse(context, principal, other.warehouse.id, 'read'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  },
);
