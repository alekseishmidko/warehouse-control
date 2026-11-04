/** @file Session context: cookie остаётся HttpOnly; профиль/CSRF только в памяти, private Query cache очищается на выходе. */
import {
  createContext,
  useContext,
  createSignal,
  onMount,
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
    const profile = await api.get('/api/v1/auth/me');
    setUser(profile);
  };
  onMount(() => {
    refresh()
      .catch(clear)
      .finally(() => setLoading(false))
      .catch(clear);
  });
  const state: SessionState = {
    user,
    loading,
    api,
    journal,
    journalVersion: version,
    async login(login, password) {
      clear();
      await api.post('/api/v1/auth/login', { login, password });
      await refresh();
    },
    async logout() {
      const csrf = user()?.csrfToken;
      try {
        if (csrf) await api.post('/api/v1/auth/logout', {}, csrf);
      } finally {
        clear();
      }
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
