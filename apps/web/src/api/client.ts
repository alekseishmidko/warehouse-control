/** @file Типизированный same-origin JSON transport: contracts из OpenAPI, safe problem mapping, bounded fetch. */
import type { paths, components } from './generated/schema';
/** Публичные DTO из OpenAPI; backend-классы и ORM-модели в браузер не импортируются. */
export type Schema = components['schemas'];
/** Выбирает только реально описанные HTTP-методы; случайный path отклоняется TypeScript при сборке. */
export type GetPath = {
  [P in keyof paths]: paths[P]['get'] extends { responses: unknown } ? P : never;
}[keyof paths];
export type PostPath = {
  [P in keyof paths]: paths[P]['post'] extends { responses: unknown } ? P : never;
}[keyof paths];
/** Credential/admin endpoints исключены: их request body нельзя сохранять в журнал складских команд. */
export type CommandPath = Exclude<
  PostPath,
  `/api/v1/auth/${string}` | `/api/v1/identity/${string}`
>;
type ResponseBody<R> = R extends { content: { 'application/json': infer T } } ? T : void;
/** У текущего API success — 200/201 либо 204 без тела; новые статусы требуют обновить transport contract. */
export type Output<P extends keyof paths, M extends 'get' | 'post'> =
  NonNullable<paths[P][M]> extends { responses: infer R }
    ? R extends { 200: infer T }
      ? ResponseBody<T>
      : R extends { 201: infer T }
        ? ResponseBody<T>
        : void
    : never;
export type PostBody<P extends PostPath> =
  NonNullable<paths[P]['post']> extends {
    requestBody: { content: { 'application/json': infer T } };
  }
    ? T
    : Record<string, never>;
/** Cursor — opaque строка сервера; клиент не вычисляет позицию или общий snapshot страниц. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
/** Закрытый список warehouse read resources связывает runtime URL с generated DTO ответа. */
export interface ResourceMap {
  balances: Schema['BalanceDto'];
  movements: Schema['MovementDto'];
  receipts: Schema['ReceiptSummaryDto'];
  'putaway-tasks': Schema['PutawaySummaryDto'];
  orders: Schema['OrderSummaryDto'];
  'picking-tasks': Schema['PickingSummaryDto'];
  shipments: Schema['ShipmentSummaryDto'];
  audit: Schema['AuditSummaryDto'];
  products: Schema['ProductReadDto'];
  locations: Schema['LocationReadDto'];
}
/** Только закрытые code/correlation поля публичной ошибки; raw server detail/SQL/HTML не показываются. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string,
  ) {
    super(code);
  }
}
/** Транспортная неопределённость: commit мог состояться. Вызывающий сохраняет команду и её key. */
export class UncertainResult extends Error {
  constructor() {
    super('UNCERTAIN_RESULT');
  }
}
/** Не вставляет произвольные URL; все paths задаёт generated контракт, значения кодируются. */
export function routeUrl(path: string, params: Record<string, string> = {}): string {
  return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    if (!params[name]) throw new Error('Missing route parameter');
    return encodeURIComponent(params[name]);
  });
}
/** JSON DTO доверяется API contract после HTTP success. Здесь нет копии серверных бизнес-проверок. */
export class ApiClient {
  /** Native fetch привязан к Window: вызов как метода ApiClient иначе даёт Illegal invocation. */
  constructor(
    private readonly unauthorized: () => void = () => {},
    private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = 15000,
  ) {}
  /** Credentials всегда same-origin; внешний signal прерывает read при logout/смене query. */
  async request<T>(
    method: 'GET' | 'POST',
    url: string,
    options: {
      body?: string;
      csrf?: string;
      key?: string;
      correlationId?: string;
      signal?: AbortSignal;
      login?: boolean;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      const response = await this.transport(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(options.login ? { 'X-CSRF-Protection': '1' } : {}),
          ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
          ...(options.key ? { 'Idempotency-Key': options.key } : {}),
          ...(options.correlationId ? { 'X-Correlation-Id': options.correlationId } : {}),
        },
        body: options.body,
      });
      if (response.status === 401 && !options.login) this.unauthorized();
      if (!response.ok) {
        const problem: unknown = await response.json().catch(() => null);
        const code =
          problem &&
          typeof problem === 'object' &&
          'code' in problem &&
          typeof problem.code === 'string'
            ? problem.code
            : 'REQUEST_FAILED';
        const correlation =
          problem &&
          typeof problem === 'object' &&
          'correlationId' in problem &&
          typeof problem.correlationId === 'string'
            ? problem.correlationId
            : undefined;
        throw new ApiError(response.status, code, correlation);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Только складская команда с сохранённым key имеет recovery. GET/login не создают журнал:
      // сообщение о неизвестном commit отправляло бы человека искать отсутствующий ключ.
      if (options.key) throw new UncertainResult();
      throw new ApiError(0, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  /** Path/response типы выводятся из generated OpenAPI; query значения передаются URLSearchParams. */
  get<P extends GetPath>(
    path: P,
    params: Record<string, string> = {},
    query: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<Output<P, 'get'>> {
    const search = new URLSearchParams(query).toString();
    return this.request('GET', routeUrl(path, params) + (search ? '?' + search : ''), { signal });
  }
  /** Auth не проходит через журнал складских команд: password и CSRF не сохраняются. */
  post<P extends PostPath>(
    path: P,
    body: PostBody<P>,
    csrf?: string,
    params: Record<string, string> = {},
  ): Promise<Output<P, 'post'>> {
    return this.request('POST', routeUrl(path, params), {
      body: JSON.stringify(body),
      csrf,
      login: path === '/api/v1/auth/login',
    });
  }
  /** Единственная runtime таблица read routes; соответствует generated path names, не произвольным именам SQL. */
  list<R extends keyof ResourceMap>(
    resource: R,
    warehouseId: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Page<ResourceMap[R]>> {
    return this.request(
      'GET',
      `/api/v1/warehouses/${encodeURIComponent(warehouseId)}/${resource}?${new URLSearchParams(query)}`,
      { signal },
    );
  }
}
