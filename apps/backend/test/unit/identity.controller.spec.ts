/** @file Контракты IdentityController: безопасные ответы, cookie policy и ожидание commit до HTTP effects; БД проверяется integration suite. */
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { IdentityController } from '@backend/modules/identity/identity.controller';
import { AuthService } from '@backend/modules/identity/services/auth.service';
import { UsersService } from '@backend/modules/identity/services/users.service';
import { IDENTITY_CONFIG, IdentityConfig } from '@backend/modules/identity/identity.config';
import { CommandError } from '@backend/shared/errors/command-error';
import { newSecret, sessionCsrf } from '@backend/shared/security/secrets';

const principal = {
  userId: '835fa102-9287-4a10-8fa2-a860048bf5cc',
  sessionId: 'f2cb7132-93da-4076-b32b-24159c6ce12d',
};
const user = { id: principal.userId, login: 'operator.one', active: true, systemAdmin: false };
const input = { login: user.login, password: 'Synthetic-Password-2026!' };

/** Узкий transport double: не имитирует guard/SQL, только наблюдает момент и состав HTTP effects. */
function responseFixture() {
  const output = {
    setHeader: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
    end: jest.fn(),
  };
  output.status.mockReturnValue(output);
  return { output, response: output as unknown as Response };
}

/** Реальный Nest DI, подменены только владельцы сценариев; политика HTTPS/HTTP остаётся production функциями. */
async function setup(secure = false) {
  const config: IdentityConfig = {
    origin: secure ? 'https://warehouse.example' : 'http://127.0.0.1:3000',
    secure,
    absoluteSeconds: 600,
    idleSeconds: 300,
  };
  const auth = { login: jest.fn(), logout: jest.fn() };
  const users = { current: jest.fn() };
  const module = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: UsersService, useValue: users },
      { provide: IDENTITY_CONFIG, useValue: config },
    ],
  }).compile();
  return { controller: module.get(IdentityController), auth, users, module };
}

/** И локальная, и HTTPS cookie должны сохранять policy; raw token допустим только в cookie, не JSON. */
test.each([false, true])(
  'login returns safe JSON and secure=%s cookie after successful service completion',
  async (secure) => {
    const { controller, auth, module } = await setup(secure);
    const { response, output } = responseFixture();
    const token = newSecret();
    auth.login.mockResolvedValue({ token, csrfToken: sessionCsrf(token), user });
    try {
      await controller.login(
        input,
        { socket: { remoteAddress: '127.0.0.7' } } as Request,
        response,
      );
      expect(auth.login).toHaveBeenCalledWith(input, '127.0.0.7');
      expect(output.cookie).toHaveBeenCalledWith(
        secure ? '__Host-wms_session' : 'wms_session',
        token,
        { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 600000 },
      );
      expect(output.cookie.mock.calls[0][2]).not.toHaveProperty('domain');
      expect(output.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(output.status).toHaveBeenCalledWith(200);
      expect(output.json).toHaveBeenCalledWith({ user, csrfToken: sessionCsrf(token) });
      expect(JSON.stringify(output.json.mock.calls)).not.toContain(token);
      expect(JSON.stringify(output.json.mock.calls)).not.toContain(input.password);
    } finally {
      await module.close();
    }
  },
);

/** Отсутствующий socket address не заменяется недоверенным X-Forwarded-For. */
test('login uses unknown peer when socket address is absent', async () => {
  const { controller, auth, module } = await setup();
  const { response } = responseFixture();
  auth.login.mockResolvedValue({ user, token: newSecret(), csrfToken: 'csrf' });
  try {
    await controller.login(
      input,
      { socket: {}, headers: { 'x-forwarded-for': 'attacker' } } as unknown as Request,
      response,
    );
    expect(auth.login).toHaveBeenCalledWith(input, 'unknown');
  } finally {
    await module.close();
  }
});

/** Deferred completion моделирует ещё не завершённый commit; отказ не должен оставить успешную cookie/JSON. */
test('login waits for persistence and propagates rejection without emitting response', async () => {
  const { controller, auth, module } = await setup();
  const { response, output } = responseFixture();
  let fail!: (error: Error) => void;
  auth.login.mockReturnValue(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const error = new CommandError('SERVICE_UNAVAILABLE');
  const pending = controller.login(input, { socket: {} } as Request, response);
  const rejected = expect(pending).rejects.toBe(error);
  try {
    expect(output.cookie).not.toHaveBeenCalled();
    expect(output.json).not.toHaveBeenCalled();
    fail(error);
    await rejected;
    expect(output.cookie).not.toHaveBeenCalled();
    expect(output.status).not.toHaveBeenCalled();
    expect(output.setHeader).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

/** me берёт trusted principal, а CSRF — от cookie текущей policy; лишнее имя cookie не выбирается. */
test.each([false, true])(
  'me returns own profile/grants and session-bound CSRF with secure=%s',
  async (secure) => {
    const { controller, users, module } = await setup(secure);
    const { response, output } = responseFixture();
    const token = newSecret();
    const name = secure ? '__Host-wms_session' : 'wms_session';
    const profile = {
      user,
      warehouseRoles: [{ warehouseId: 'a56344ee-eebe-40bf-a1fb-f6b3362e9da5', role: 'viewer' }],
    };
    users.current.mockResolvedValue(profile);
    try {
      await controller.me(
        principal,
        { headers: { cookie: `other=ignored; ${name}=${token}` } } as Request,
        response,
      );
      expect(users.current).toHaveBeenCalledWith(principal);
      expect(output.json).toHaveBeenCalledWith({ ...profile, csrfToken: sessionCsrf(token) });
      expect(output.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(output.setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
      expect(output.cookie).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  },
);

/** Отзыв между guard и current не должен превратить устаревший principal в успешный профиль. */
test('me propagates fresh-session denial without returning a profile', async () => {
  const { controller, users, module } = await setup();
  const { response, output } = responseFixture();
  const error = new CommandError('UNAUTHORIZED');
  users.current.mockRejectedValue(error);
  try {
    await expect(controller.me(principal, { headers: {} } as Request, response)).rejects.toBe(
      error,
    );
    expect(output.json).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

/** Cookie удаляется с тем же именем/path/Secure только после committed revoke; тело 204 отсутствует. */
test.each([false, true])(
  'logout clears matching secure=%s cookie only after session revoke',
  async (secure) => {
    const { controller, auth, module } = await setup(secure);
    const { response, output } = responseFixture();
    let complete!: () => void;
    auth.logout.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    try {
      const pending = controller.logout(principal, response);
      expect(output.clearCookie).not.toHaveBeenCalled();
      expect(output.end).not.toHaveBeenCalled();
      complete();
      await pending;
      expect(auth.logout).toHaveBeenCalledWith(principal);
      expect(output.clearCookie).toHaveBeenCalledWith(
        secure ? '__Host-wms_session' : 'wms_session',
        { httpOnly: true, secure, sameSite: 'strict', path: '/' },
      );
      expect(output.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(output.status).toHaveBeenCalledWith(204);
      expect(output.end).toHaveBeenCalledTimes(1);
      expect(output.json).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  },
);

/** При SQL/commit отказе клиент сохраняет cookie для повторной попытки, 204 не выдаётся. */
test('logout failure does not clear cookie or report success', async () => {
  const { controller, auth, module } = await setup();
  const { response, output } = responseFixture();
  const error = new Error('synthetic revoke failure');
  auth.logout.mockRejectedValue(error);
  try {
    await expect(controller.logout(principal, response)).rejects.toBe(error);
    expect(output.clearCookie).not.toHaveBeenCalled();
    expect(output.status).not.toHaveBeenCalled();
    expect(output.end).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});
