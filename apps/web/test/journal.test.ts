/** @file AC-208-04/06: журнал связывает actor/URL/body/key; unknown commit никогда не становится новым автоматическим запросом. */
import { it, expect, vi } from 'vitest';
import { CommandJournal } from '../src/commands/journal';
import { ApiClient, ApiError, UncertainResult } from '../src/api/client';
const user = crypto.randomUUID(),
  warehouse = crypto.randomUUID();
const body = { warehouseId: warehouse, lines: [{ productId: crypto.randomUUID(), quantity: 3 }] };
it('lost response persists across journal recreation; retry retains exact request/key and uses current CSRF', async () => {
  const calls: RequestInit[] = [];
  let fail = true;
  const api = new ApiClient(
    () => {},
    async (_url, init) => {
      calls.push(init!);
      if (fail) throw new Error('lost');
      return new Response('{"id":"saved"}');
    },
  );
  const first = new CommandJournal(sessionStorage, api);
  await expect(
    first.execute(user, warehouse, 'Создание заказа', '/api/v1/orders', body, 'csrf-before'),
  ).rejects.toBeInstanceOf(UncertainResult);
  const stored = first.read(user)!;
  expect(stored.key).toBeTruthy();
  expect(JSON.stringify(stored)).not.toContain('csrf-before');
  expect(first.read(crypto.randomUUID())).toBeNull();
  const restored = new CommandJournal(sessionStorage, api);
  await expect(
    restored.execute(user, warehouse, 'Другая команда', '/api/v1/orders', body, 'csrf-after'),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  fail = false;
  expect(await restored.send(user, 'csrf-after')).toEqual({ id: 'saved' });
  expect(calls[1].body).toBe(calls[0].body);
  expect(calls[1].headers).toMatchObject({
    'Idempotency-Key': stored.key,
    'X-CSRF-Token': 'csrf-after',
    'X-Correlation-Id': stored.correlationId,
  });
  expect(restored.read(user)).toBeNull();
});
it.each([400, 403, 409])('explicit %s rejection clears request after failure', async (status) => {
  const journal = new CommandJournal(
    sessionStorage,
    new ApiClient(
      () => {},
      async () => new Response('{"code":"FORBIDDEN"}', { status }),
    ),
  );
  await expect(
    journal.execute(user, warehouse, 'Резерв', '/api/v1/orders', body, 'csrf'),
  ).rejects.toBeInstanceOf(ApiError);
  expect(journal.read(user)).toBeNull();
});
it.each([401, 500, 503])('ambiguous/session %s retains original request', async (status) => {
  const journal = new CommandJournal(
    sessionStorage,
    new ApiClient(
      () => {},
      async () => new Response('{}', { status }),
    ),
  );
  await expect(
    journal.execute(user, warehouse, 'Заказ', '/api/v1/orders', body, 'csrf'),
  ).rejects.toBeInstanceOf(status === 401 ? ApiError : UncertainResult);
  expect(journal.read(user)).not.toBeNull();
});
it('double click while first fetch awaits does not issue a second operation', async () => {
  let release!: () => void;
  const started = vi.fn();
  const api = new ApiClient(
    () => {},
    async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response('{}');
    },
  );
  const journal = new CommandJournal(sessionStorage, api);
  const first = journal.execute(user, warehouse, 'Заказ', '/api/v1/orders', body, 'csrf');
  await expect(
    journal.execute(user, warehouse, 'Заказ', '/api/v1/orders', body, 'csrf'),
  ).rejects.toThrow();
  await expect(journal.send(user, 'csrf')).rejects.toThrow();
  expect(started).toHaveBeenCalledTimes(1);
  release();
  await first;
});
it('storage failure prevents HTTP side effect; invalid journals never replay auth/admin', async () => {
  const transport = vi.fn<typeof fetch>(),
    api = new ApiClient(() => {}, transport);
  const storage = {
    setItem() {
      throw new Error('quota');
    },
    getItem() {
      return null;
    },
  } as unknown as Storage;
  await expect(
    new CommandJournal(storage, api).execute(
      user,
      warehouse,
      'Заказ',
      '/api/v1/orders',
      body,
      'csrf',
    ),
  ).rejects.toThrow('COMMAND_SAVE_FAILED');
  expect(transport).not.toHaveBeenCalled();
  const journal = new CommandJournal(sessionStorage, api);
  for (const text of [
    '{',
    'null',
    '{}',
    JSON.stringify({
      version: 1,
      userId: user,
      warehouseId: warehouse,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: '/api/v1/auth/login',
      body: '{}',
      label: 'bad',
    }),
  ]) {
    sessionStorage.setItem(`wms-pending-v1:${user}`, text);
    expect(journal.read(user)).toBeNull();
    await expect(journal.send(user, 'csrf')).rejects.toThrow();
  }
});

it('unavailable storage read is safe; execute still refuses to send without durable save', async () => {
  const transport = vi.fn<typeof fetch>();
  const storage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  } as unknown as Storage;
  const journal = new CommandJournal(storage, new ApiClient(() => {}, transport));
  expect(journal.read(user)).toBeNull();
  await expect(
    journal.execute(user, warehouse, 'Заказ', '/api/v1/orders', body, 'csrf'),
  ).rejects.toThrow('COMMAND_SAVE_FAILED');
  expect(transport).not.toHaveBeenCalled();
});

it.each([400, 403, 409])(
  'failed replay %s cannot discard a previously uncertain commit',
  async (status) => {
    let failed = true;
    const api = new ApiClient(
      () => {},
      async () => {
        if (failed) throw new Error('lost response');
        return new Response('{"code":"FORBIDDEN"}', { status });
      },
    );
    const journal = new CommandJournal(sessionStorage, api);
    await expect(
      journal.execute(user, warehouse, 'Заказ', '/api/v1/orders', body, 'csrf'),
    ).rejects.toBeInstanceOf(UncertainResult);
    const original = journal.read(user)!.key;
    failed = false;
    await expect(journal.send(user, 'csrf-after')).rejects.toBeInstanceOf(ApiError);
    expect(journal.read(user)?.key).toBe(original);
  },
);

it('HTTP 408 preserves the original command and explicit replay keeps its key and body', async () => {
  const calls: RequestInit[] = [];
  const journal = new CommandJournal(
    sessionStorage,
    new ApiClient(
      () => {},
      async (_url, init) => {
        calls.push(init!);
        return calls.length === 1 ? new Response('{}', { status: 408 }) : new Response('{}');
      },
    ),
  );
  await expect(
    journal.execute(user, warehouse, 'Заказ', '/api/v1/orders', body, 'csrf'),
  ).rejects.toBeInstanceOf(UncertainResult);
  const saved = journal.read(user)!;
  expect(saved).not.toBeNull();
  await expect(
    journal.execute(user, warehouse, 'Другой заказ', '/api/v1/orders', body, 'csrf'),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  await journal.send(user, 'new-csrf');
  expect(calls[1].body).toBe(saved.body);
  expect(calls[1].headers).toMatchObject({ 'Idempotency-Key': saved.key });
  expect(journal.read(user)).toBeNull();
});

it.each(['warehouseId', 'key', 'correlationId'] as const)(
  'storage UUID %s must be a string; array coercion never reaches fetch',
  async (field) => {
    const pending = {
      version: 1,
      userId: user,
      warehouseId: warehouse,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: '/api/v1/orders',
      body: JSON.stringify(body),
      label: 'Заказ',
    };
    const text = JSON.stringify({ ...pending, [field]: [pending[field]] });
    sessionStorage.setItem(`wms-pending-v1:${user}`, text);
    const transport = vi.fn(async () => new Response('{}'));
    const journal = new CommandJournal(sessionStorage, new ApiClient(() => {}, transport));
    expect(journal.read(user)).toBeNull();
    await expect(journal.send(user, 'current-csrf')).rejects.toThrow('Команда недоступна.');
    expect(transport).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`wms-pending-v1:${user}`)).toBe(text);
  },
);

it.each([
  { body: null },
  { body: JSON.stringify({ padding: 'x'.repeat(262144) }) },
  { label: null },
  { label: 'x'.repeat(121) },
  { body: 'null' },
  { body: '[]' },
  { body: '{"password":"synthetic-secret"}' },
  { body: '{"csrfToken":"synthetic-secret"}' },
  { version: 2 },
  { userId: crypto.randomUUID() },
])(
  'malformed or credential-bearing storage entry cannot be replayed: case %#',
  async (override) => {
    const text = JSON.stringify({
      version: 1,
      userId: user,
      warehouseId: warehouse,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: '/api/v1/orders',
      body: JSON.stringify(body),
      label: 'Заказ',
      ...override,
    });
    sessionStorage.setItem(`wms-pending-v1:${user}`, text);
    const transport = vi.fn(async () => new Response('{}'));
    const journal = new CommandJournal(sessionStorage, new ApiClient(() => {}, transport));
    expect(journal.read(user)).toBeNull();
    await expect(journal.send(user, 'csrf')).rejects.toThrow('Команда недоступна.');
    expect(transport).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`wms-pending-v1:${user}`)).toBe(text);
  },
);
