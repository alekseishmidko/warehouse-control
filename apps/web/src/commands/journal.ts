/** @file Durable per-tab журнал одной неподтверждённой команды на пользователя; credentials/CSRF сюда не попадают. */
import {
  ApiClient,
  ApiError,
  UncertainResult,
  routeUrl,
  type CommandPath,
  type PostBody,
  type Output,
} from '../api/client';
/** Снимок намерения, не proof commit. UUID user/склада нужны для scope; доверие actor по-прежнему задаёт сервер. */
export interface PendingCommand {
  version: 1;
  userId: string;
  warehouseId: string;
  key: string;
  correlationId: string;
  url: string;
  body: string;
  label: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commandUrl =
  /^\/api\/v1\/(receipts|orders)(\/[0-9a-f-]{36}\/(post|confirm|reserve|cancel|picking-tasks|shipments|cancellation-return|allocations\/[0-9a-f-]{36}\/release))?$|^\/api\/v1\/(putaway-tasks\/[0-9a-f-]{36}\/execute|picking-tasks\/[0-9a-f-]{36}\/(start|confirm)|shipments\/[0-9a-f-]{36}\/(post|cancel))$/i;
/** Storage — same-tab sessionStorage; factory откладывает browser getter до защищённой операции чтения/записи. */
export class CommandJournal {
  private readonly inFlight = new Set<string>();
  constructor(
    private readonly storage: Storage | (() => Storage),
    private readonly api: ApiClient,
    private readonly changed: () => void = () => {},
  ) {}
  /** Получение browser storage само может бросить SecurityError; вызывается внутри тех же try, что getItem/setItem. */
  private getStorage(): Storage {
    return typeof this.storage === 'function' ? this.storage() : this.storage;
  }
  private storageKey(userId: string) {
    return `wms-pending-v1:${userId}`;
  }
  /** Данные storage недоверенные. Неверная запись не отправляется в API и не выбирает actor текущей сессии. */
  read(userId: string): PendingCommand | null {
    try {
      const text = this.getStorage().getItem(this.storageKey(userId));
      if (!text) return null;
      const p: unknown = JSON.parse(text);
      if (!p || typeof p !== 'object') return null;
      const x = p as Partial<PendingCommand>;
      if (
        x.version !== 1 ||
        x.userId !== userId ||
        !x.warehouseId ||
        !uuid.test(x.warehouseId) ||
        !x.key ||
        !uuid.test(x.key) ||
        !x.correlationId ||
        !uuid.test(x.correlationId) ||
        typeof x.url !== 'string' ||
        !commandUrl.test(x.url) ||
        typeof x.body !== 'string' ||
        new TextEncoder().encode(x.body).length > 262144 ||
        typeof x.label !== 'string' ||
        x.label.length > 120
      )
        return null;
      const body: unknown = JSON.parse(x.body);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        'password' in body ||
        'csrfToken' in body
      )
        return null;
      return x as PendingCommand;
    } catch {
      return null;
    }
  }
  /** Сохранение выполняется ДО fetch. Если storage недоступен, команда не отправляется. */
  async execute<P extends CommandPath>(
    userId: string,
    warehouseId: string,
    label: string,
    path: P,
    body: PostBody<P>,
    csrf: string,
    params: Record<string, string> = {},
  ): Promise<Output<P, 'post'>> {
    if (this.read(userId) || this.inFlight.has(userId))
      throw new Error('Сначала проверьте сохранённую команду.');
    const pending: PendingCommand = {
      version: 1,
      userId,
      warehouseId,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: routeUrl(path, params),
      body: JSON.stringify(body),
      label,
    };
    try {
      this.getStorage().setItem(this.storageKey(userId), JSON.stringify(pending));
    } catch {
      throw new ApiError(0, 'COMMAND_SAVE_FAILED');
    }
    this.changed();
    return this.dispatch(userId, csrf, true) as Promise<Output<P, 'post'>>;
  }
  /** Явное действие человека: тот же URL/body/key/correlation, но актуальный CSRF новой сессии. */
  async send(userId: string, csrf: string): Promise<unknown> {
    return this.dispatch(userId, csrf, false);
  }
  /** Ошибка replay не доказывает rollback исходной команды: ACL/DTO могли измениться до lookup сохранённого результата. */
  private async dispatch(userId: string, csrf: string, firstAttempt: boolean): Promise<unknown> {
    const p = this.read(userId);
    if (!p || this.inFlight.has(userId)) throw new Error('Команда недоступна.');
    this.inFlight.add(userId);
    try {
      const result = await this.api.request('POST', p.url, {
        body: p.body,
        key: p.key,
        correlationId: p.correlationId,
        csrf,
      });
      this.getStorage().removeItem(this.storageKey(userId));
      return result;
    } catch (error) {
      // Timeout от промежуточного HTTP-узла и 5xx не подтверждают отсутствие commit.
      // Классифицируем их до удаления pending, чтобы 408 не попал в общий диапазон 4xx.
      if (error instanceof ApiError && (error.status === 408 || error.status >= 500))
        throw new UncertainResult();
      // Первый оставшийся 4xx — явный отказ. Ошибка replay не разрешает забыть неизвестный исход.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 401 &&
        firstAttempt
      )
        this.getStorage().removeItem(this.storageKey(userId));
      throw error;
    } finally {
      this.inFlight.delete(userId);
      this.changed();
    }
  }
}
