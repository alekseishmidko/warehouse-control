/** @file Координация workspace: server справочники, single-flight команды, invalidation после подтверждения commit. */
import {
  createContext,
  useContext,
  createSignal,
  Show,
  type Accessor,
  type ParentProps,
} from 'solid-js';
import { useQueryClient } from '@tanstack/solid-query';
import { useSession } from '../session/session';
import { useWarehouseList } from './queries';
import type { CommandPath, PostBody, Output, Schema } from '../api/client';
interface Workspace {
  warehouse: Accessor<string>;
  products: Accessor<Schema['ProductReadDto'][]>;
  locations: Accessor<Schema['LocationReadDto'][]>;
  busy: Accessor<boolean>;
  error: Accessor<unknown>;
  notice: Accessor<string>;
  setError: (error: unknown) => void;
  setNotice: (text: string) => void;
  productLabel: (id: string) => string;
  locationLabel: (id: string) => string;
  send: <P extends CommandPath>(
    label: string,
    path: P,
    body: PostBody<P>,
    params?: Record<string, string>,
  ) => Promise<Output<P, 'post'> | undefined>;
  refresh: () => void;
  loadProducts: () => void;
  loadLocations: () => void;
  moreProducts: Accessor<boolean>;
  moreLocations: Accessor<boolean>;
}
const Context = createContext<Workspace>();
/** При смене склада provider пересоздаётся keyed Show: выбранные документы/формы не переходят в чужой scope. */
export function WorkspaceProvider(props: ParentProps<{ warehouseId: string }>) {
  const session = useSession(),
    queries = useQueryClient();
  const warehouse = () => props.warehouseId;
  const products = useWarehouseList('products', warehouse),
    locations = useWarehouseList('locations', warehouse);
  const [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal<unknown>(),
    [notice, setNotice] = createSignal('');
  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['private'] }).catch(setError);
  };
  const state: Workspace = {
    warehouse,
    products: () => products.data?.pages.flatMap((p) => p.items) ?? [],
    locations: () => locations.data?.pages.flatMap((p) => p.items) ?? [],
    busy,
    error: () => error() ?? products.error ?? locations.error,
    notice,
    setError,
    setNotice,
    refresh,
    productLabel: (id) =>
      state.products().find((p) => p.id === id)?.sku ?? `Товар #${id.slice(0, 8)}`,
    locationLabel: (id) =>
      state.locations().find((l) => l.id === id)?.code ?? `Ячейка #${id.slice(0, 8)}`,
    moreProducts: () => products.hasNextPage,
    moreLocations: () => locations.hasNextPage,
    loadProducts: () => {
      products.fetchNextPage().catch(setError);
    },
    loadLocations: () => {
      locations.fetchNextPage().catch(setError);
    },
    async send(label, path, body, params = {}) {
      const user = session.user();
      if (!user || busy()) return;
      setBusy(true);
      setError(undefined);
      setNotice('');
      try {
        const result = await session.journal.execute(
          user.user.id,
          warehouse(),
          label,
          path,
          body,
          user.csrfToken,
          params,
        ); // Не снимаем busy до завершения перечитывания: refetch не должен сбросить уже редактируемое количество.
        await queries.invalidateQueries({ queryKey: ['private'] });
        setNotice(`${label}: выполнено`);
        return result;
      } catch (e) {
        setError(e);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
  };
  return (
    <Context.Provider value={state}>
      <fieldset disabled={busy()} class="workspace-fields">
        {/* Пустой select не объясняет причину: загрузка и успешное отсутствие справочника — разные состояния. */}
        <Show when={products.isPending || locations.isPending}>
          <p role="status">Загружаем товары и ячейки…</p>
        </Show>
        <Show when={products.isSuccess && state.products().length === 0}>
          <p class="notice warning">В справочнике нет товаров. Обратитесь к администратору.</p>
        </Show>
        <Show when={locations.isSuccess && state.locations().length === 0}>
          <p class="notice warning">На складе нет ячеек. Обратитесь к администратору.</p>
        </Show>
        {props.children}
      </fieldset>
    </Context.Provider>
  );
}
/** Отсутствие provider — ошибка composition, а не fallback к первому складу. */
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkspaceProvider required');
  return value;
}
