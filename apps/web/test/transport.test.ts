/** @file AC-208-02/06: транспорт не раскрывает raw errors, прерывает read и сохраняет политику cookie/CSRF. */
import { describe, it, expect, vi } from 'vitest';
import { ApiClient, ApiError, UncertainResult, routeUrl } from '../src/api/client';
import { problemMessage } from '../src/api/problems';
describe('same-origin API transport', () => {
  it('GET сериализует filters; POST auth/session policy не сохраняет credential в URL', async () => {
    const calls: RequestInit[] = [];
    const urls: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      urls.push(String(input));
      calls.push(init!);
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const api = new ApiClient(() => {}, transport);
    await api.get(
      '/api/v1/receipts/{receiptId}',
      { receiptId: 'a/b' },
      { status: 'draft', cursor: 'a+b' },
    );
    expect(urls[0]).toBe('/api/v1/receipts/a%2Fb?status=draft&cursor=a%2Bb');
    await api.post('/api/v1/auth/login', { login: 'operator', password: 'synthetic-password' });
    expect(calls[1].credentials).toBe('same-origin');
    expect(calls[1].headers).toMatchObject({
      'X-CSRF-Protection': '1',
      'Content-Type': 'application/json',
    });
    expect(urls[1]).not.toContain('password');
    await api.post('/api/v1/auth/logout', {}, 'csrf');
    expect(calls[2].headers).toMatchObject({ 'X-CSRF-Token': 'csrf' });
    expect(() => routeUrl('/x/{id}')).toThrow('Missing route parameter');
  });
  it('safe problem mapper ignores server detail and invalid response JSON', async () => {
    const unauthorized = vi.fn();
    const api = new ApiClient(
      unauthorized,
      async () =>
        new Response(
          JSON.stringify({ code: 'FORBIDDEN', correlationId: 'trace', detail: 'password=secret' }),
          { status: 403 },
        ),
    );
    let error: unknown;
    try {
      await api.get('/api/v1/auth/me');
    } catch (e) {
      error = e;
    }
    expect(problemMessage(error)).toContain('нет права');
    expect(problemMessage(error)).not.toContain('secret');
    expect(unauthorized).not.toHaveBeenCalled();
    const invalid = new ApiClient(
      () => {},
      async () => new Response('<h1>SQL secret</h1>', { status: 500 }),
    );
    await expect(invalid.get('/api/v1/auth/me')).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    expect(problemMessage(new Error('password=secret'))).not.toContain('secret');
    expect(problemMessage(new ApiError(400, 'NEW_CODE'))).toContain('Операция отклонена');
  });
  it('401 clears private session for reads, but login failure stays in login form', async () => {
    const clear = vi.fn(),
      api = new ApiClient(clear, async () => new Response('{}', { status: 401 }));
    await expect(api.get('/api/v1/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(clear).toHaveBeenCalledTimes(1);
    await expect(
      api.post('/api/v1/auth/login', { login: 'operator', password: 'synthetic-password' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(clear).toHaveBeenCalledTimes(1);
  });
  it('204 не разбирается как JSON; сетевой сбой и malformed success — неопределённый результат', async () => {
    expect(
      await new ApiClient(
        () => {},
        async () => new Response(null, { status: 204 }),
      ).post('/api/v1/auth/logout', {}, 'csrf'),
    ).toBeUndefined();
    await expect(
      new ApiClient(
        () => {},
        async () => {
          throw new Error('socket');
        },
      ).request('POST', '/api/v1/receipts', { body: '{}', key: 'saved-command-key' }),
    ).rejects.toBeInstanceOf(UncertainResult);
    await expect(
      new ApiClient(
        () => {},
        async () => new Response('bad'),
      ).request('POST', '/api/v1/receipts', { body: '{}', key: 'saved-command-key' }),
    ).rejects.toBeInstanceOf(UncertainResult);
  });
  it('timeout abort и внешний abort действительно завершают fetch', async () => {
    vi.useFakeTimers();
    const transport: typeof fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const api = new ApiClient(() => {}, transport, 50);
    const pending = api.get('/api/v1/auth/me');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
    const controller = new AbortController();
    const another = api.get('/api/v1/auth/me', {}, {}, controller.signal);
    const rejected = expect(another).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    controller.abort();
    await rejected;
  });
});

it('native browser fetch receives globalThis rather than ApiClient as receiver', async () => {
  vi.stubGlobal('fetch', function (this: unknown) {
    expect(this).toBe(globalThis);
    return Promise.resolve(new Response('{}'));
  });
  await new ApiClient().get('/api/v1/auth/me');
});

it('read/auth network failure never asks for a nonexistent saved command key', async () => {
  const api = new ApiClient(
    () => {},
    async () => {
      throw new Error('socket');
    },
  );
  // GET и login не создают запись журнала. Сообщение не должно направлять человека к отсутствующему recovery.
  for (const request of [
    () => api.get('/api/v1/auth/me'),
    () => api.post('/api/v1/auth/login', { login: 'operator', password: 'synthetic-password' }),
  ]) {
    let error: unknown;
    try {
      await request();
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
    expect(problemMessage(error)).not.toContain('ключ');
  }
});
