/** @file Security orchestration AuthService: отказ до session write при лимите/crypto failure и смене credentials между read и повторной проверкой. */
import { Test } from '@nestjs/testing';
import { AuthService } from '@backend/modules/identity/services/auth.service';
import { SessionsService } from '@backend/modules/identity/services/sessions.service';
import { IdentityRepository } from '@backend/modules/identity/repositories/identity.repository';
import { IdentityTransactionsService } from '@backend/modules/identity/services/identity-transactions.service';
import type { TransactionContext } from '@backend/shared/transactions/transaction.port';
import * as passwords from '@backend/shared/security/password';
const input = { login: 'Operator.One', password: 'Synthetic-Password-2026!' };
const row = {
  id: 'a56344ee-eebe-40bf-a1fb-f6b3362e9da5',
  login: 'operator.one',
  password_hash: passwords.DUMMY_PASSWORD_HASH,
  active: true,
  system_admin: false,
};

/** Mock crypto задаёт точку между read и recheck; реальные scrypt/SQL/locks проверяются другими suites. */
async function setup() {
  const context = {} as TransactionContext;
  const transactions = {
    run: jest.fn(async (work: (context: TransactionContext) => Promise<unknown>) => work(context)),
  };
  const repository = {
    loginAttempt: jest.fn().mockResolvedValue(true),
    findUserByLogin: jest.fn().mockResolvedValue({ ...row }),
    lockAndFindUser: jest.fn().mockResolvedValue({ ...row }),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ token: 'synthetic-cookie-token', csrfToken: 'csrf' }),
    logout: jest.fn(),
  };
  const verify = jest.spyOn(passwords, 'verifyPassword').mockResolvedValue(true);
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: IdentityTransactionsService, useValue: transactions },
      { provide: IdentityRepository, useValue: repository },
      { provide: SessionsService, useValue: sessions },
    ],
  }).compile();
  return { auth: module.get(AuthService), module, repository, sessions, verify, context };
}

/** Изменение active/hash или исчезновение пользователя после дорогой проверки не должно принять старый пароль. */
test.each([null, { ...row, active: false }, { ...row, password_hash: 'changed-after-read' }])(
  'login rejects changed user after password verification %#',
  async (current) => {
    const { auth, module, repository, sessions, verify } = await setup();
    repository.lockAndFindUser.mockResolvedValue(current);
    try {
      await expect(auth.login(input, '127.0.0.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(sessions.create).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  },
);

/** Crypto overload отражается безопасным 503-кодом; внутреннее сообщение не выходит клиенту. */
test('hashing failure maps to safe unavailable and creates no session', async () => {
  const { auth, module, sessions, verify } = await setup();
  verify.mockRejectedValue(new Error('internal synthetic crypto capacity'));
  try {
    await expect(auth.login(input, '127.0.0.1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'SERVICE_UNAVAILABLE',
    });
    expect(sessions.create).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

/** Заблокированный peer не создаёт новую login область и не запускает scrypt. */
test('peer throttle stops before account window or hashing', async () => {
  const { auth, module, repository, sessions, verify } = await setup();
  repository.loginAttempt.mockResolvedValue(false);
  try {
    await expect(auth.login(input, '127.0.0.1')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(repository.loginAttempt).toHaveBeenCalledTimes(1);
    expect(repository.findUserByLogin).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

/** Absent/wrong/blocked дают одинаковый отказ; отсутствующему пользователю всё равно выполняется dummy verification. */
test.each(['absent', 'wrong', 'blocked'])(
  'login hides %s account state without creating session',
  async (kind) => {
    const { auth, module, repository, sessions, verify } = await setup();
    if (kind === 'absent') repository.findUserByLogin.mockResolvedValue(null);
    if (kind === 'wrong') verify.mockResolvedValue(false);
    if (kind === 'blocked') repository.findUserByLogin.mockResolvedValue({ ...row, active: false });
    try {
      await expect(auth.login(input, '127.0.0.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(verify).toHaveBeenCalledWith(input.password, passwords.DUMMY_PASSWORD_HASH);
      expect(sessions.create).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  },
);

/** Проверенный пользователь и session writer получают тот же context; публичный профиль не раскрывает password hash. */
test('login creates session with borrowed context and projects safe user', async () => {
  const { auth, module, repository, sessions, context } = await setup();
  try {
    const result = await auth.login(input, '127.0.0.1');
    expect(repository.findUserByLogin).toHaveBeenCalledWith(context, 'operator.one');
    expect(sessions.create).toHaveBeenCalledWith(context, row.id);
    expect(result.user).toEqual({ id: row.id, login: row.login, active: true, systemAdmin: false });
    expect(JSON.stringify(result)).not.toContain(row.password_hash);
  } finally {
    await module.close();
  }
});
