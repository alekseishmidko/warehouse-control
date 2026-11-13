/** @file Session context: cookie остаётся HttpOnly; профиль/CSRF только в памяти, private Query cache очищается на выходе. */
import {
  createContext,
  useContext,
  createSignal,
  onMount,
  untrack,
  type Accessor,
  type ParentProps,
} from 'solid-js';
import { useQueryClient, type QueryClient } from '@tanstack/solid-query';
import { ApiClient, type Schema } from '../api/client';
import { CommandJournal } from '../commands/journal';
interface SessionState {
  user: Accessor<Schema['CurrentUserDto'] | null>;
  loading: Accessor<boolean>;
  api: ApiClient;
  journal: CommandJournal;
  journalVersion: Accessor<number>;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<SessionState>();
/** Сначала abort всех read requests, затем purge. Поздний запрос не вправе восстановить private cache после logout. */
export function clearPrivateCache(client: QueryClient): void {
  void client.cancelQueries().catch(() => {});
  client.clear();
}
/** Provider не импортирует backend. HTTP 401 очищает user и cache, журнал другого пользователя не читается. */
export function SessionProvider(props: ParentProps) {
  const queries = useQueryClient();
  const [user, setUser] = createSignal<Schema['CurrentUserDto'] | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [version, setVersion] = createSignal(0);
  const clear = () => {
    api.advanceSession();
    clearPrivateCache(queries);
    setUser(null);
  };
  const api = new ApiClient(clear);
  const journal = new CommandJournal(
    () => sessionStorage,
    api,
    () => setVersion((v) => v + 1),
  );
  const refresh = async () => {
    const revision = api.sessionRevision;
    const profile = await api.get('/api/v1/auth/me');
    if (revision === api.sessionRevision) setUser(profile);
  };
  onMount(() => {
    const revision = api.sessionRevision;
    refresh()
      .catch(() => {
        if (revision === api.sessionRevision) clear();
      })
      .finally(() => setLoading(false))
      .catch(clear);
  });
  // Ответы login/logout содержат Set-Cookie: сетевой порядок должен совпадать с порядком намерений.
  // Ошибка одной операции возвращается caller, но не блокирует следующую попытку входа.
  let authentication = Promise.resolve();
  const authenticateInOrder = (operation: () => Promise<void>): Promise<void> => {
    const next = authentication.then(operation);
    authentication = next.catch(() => {});
    return next;
  };
  const state: SessionState = {
    user,
    loading,
    api,
    journal,
    journalVersion: version,
    login(login, password) {
      return authenticateInOrder(async () => {
        clear();
        await api.post('/api/v1/auth/login', { login, password });
        await refresh();
      });
    },
    logout() {
      return authenticateInOrder(async () => {
        api.advanceSession();
        const revision = api.sessionRevision;
        // Берём одноразовый снимок при исполнении очереди, без реактивной подписки.
        const csrf = untrack(user)?.csrfToken;
        try {
          if (csrf) await api.post('/api/v1/auth/logout', {}, csrf);
        } finally {
          if (revision === api.sessionRevision) clear();
        }
      });
    },
  };
  return <Context.Provider value={state}>{props.children}</Context.Provider>;
}
/** Контекст обязателен: отсутствие provider не превращается в фиктивного пользователя. */
export function useSession() {
  const context = useContext(Context);
  if (!context) throw new Error('SessionProvider required');
  return context;
}
