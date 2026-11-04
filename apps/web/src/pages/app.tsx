/** @file Оболочка SPA: восстановление session, readable warehouses, scoped workspace и Solid Router навигация. */
import { createSignal, For, Show, Switch, Match } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { createInfiniteQuery, useQueryClient } from '@tanstack/solid-query';
import { useSession } from '../session/session';
import { WorkspaceProvider, useWorkspace } from '../data/workspace';
import { Login } from '../components/login';
import { ErrorNotice } from '../components/ui';
import { Recovery } from '../components/recovery';
import { StockPage } from './stock';
import { ReceivingPage } from './receiving';
import { PutawayPage } from './putaway';
import { OrdersPage } from './orders';
import { PickingPage } from './picking';
import { ShippingPage } from './shipping';
import { HistoryPage } from './history';
const navigation = [
  ['/', 'Обзор остатков', '▦'],
  ['/receipts', 'Приёмка', '↓'],
  ['/putaway', 'Размещение', '↳'],
  ['/orders', 'Заказы', '▤'],
  ['/picking', 'Сборка', '✓'],
  ['/shipments', 'Отгрузка', '↑'],
  ['/history', 'История', '◷'],
];
/** SessionProvider закрывает область данных до login; system admin без grants увидит пустой выбор склада. */
export function App() {
  const session = useSession();
  const [warehouse, setWarehouse] = createSignal(''),
    [error, setError] = createSignal<unknown>();
  const warehouses = createInfiniteQuery(() => ({
    queryKey: ['private', session.user()?.user.id, 'warehouses'],
    enabled: !!session.user(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.api.get(
        '/api/v1/warehouses',
        {},
        { limit: '100', ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  }));
  const selected = () =>
    warehouses.data?.pages.flatMap((p) => p.items).some((w) => w.id === warehouse())
      ? warehouse()
      : '';
  return (
    <Show
      when={!session.loading()}
      fallback={
        <main class="loading" role="status">
          Восстанавливаем сессию…
        </main>
      }
    >
      <Show
        when={session.user()}
        fallback={
          <>
            <ErrorNotice error={error()} />
            <Login onLogin={session.login} />
          </>
        }
      >
        <a
          class="skip-link"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('main-content')?.focus();
          }}
        >
          Перейти к содержимому
        </a>
        <div class="app-shell">
          <aside>
            <a class="brand" href="/">
              <span class="brand-mark">W</span>
              <span>
                WAREHOUSE<small>CONTROLLER</small>
              </span>
            </a>
            <p class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p>
            <nav aria-label="Основная навигация">
              <For each={navigation}>
                {(item) => (
                  <A href={item[0]} end={item[0] === '/'} activeClass="active">
                    <span aria-hidden="true">{item[2]}</span>
                    {item[1]}
                  </A>
                )}
              </For>
            </nav>
            <div class="sidebar-foot">
              <span class="online-dot" />
              Учёт операций в PostgreSQL<small>Все изменения фиксируются сервером</small>
            </div>
          </aside>
          <div class="main-shell">
            <header>
              <div class="warehouse-control">
                <label for="warehouse-select">Текущий склад</label>
                <select
                  id="warehouse-select"
                  value={selected()}
                  onChange={(e) => setWarehouse(e.currentTarget.value)}
                >
                  <option value="">Выберите склад</option>
                  <For each={warehouses.data?.pages.flatMap((p) => p.items) ?? []}>
                    {(w) => (
                      <option value={w.id}>
                        {w.name} · {w.code}
                      </option>
                    )}
                  </For>
                </select>
                <Show when={warehouses.hasNextPage}>
                  <button
                    class="ghost"
                    onClick={() => {
                      warehouses.fetchNextPage().catch(setError);
                    }}
                  >
                    Ещё склады
                  </button>
                </Show>
              </div>
              <div class="user-menu">
                <span>{session.user()?.user.login}</span>
                <button
                  class="ghost"
                  onClick={() => {
                    session.logout().catch(setError);
                    setWarehouse('');
                  }}
                >
                  Выйти
                </button>
              </div>
            </header>
            <main id="main-content" tabIndex={-1}>
              <ErrorNotice error={error() ?? warehouses.error} />
              <Show
                when={selected()}
                keyed
                fallback={
                  <section class="panel welcome">
                    <p class="eyebrow">НАЧАЛО РАБОТЫ</p>
                    <h1>Выберите склад</h1>
                    <p class="muted">
                      Здесь доступны склады с вашей ролью. Если список пуст, обратитесь к
                      администратору.
                    </p>
                    <Show when={warehouses.isPending}>
                      <p role="status">Загрузка складов…</p>
                    </Show>
                  </section>
                }
              >
                {(id) => (
                  <WorkspaceProvider warehouseId={id}>
                    <WorkspaceContent />
                  </WorkspaceProvider>
                )}
              </Show>
            </main>
            <footer>
              Warehouse Controller <span>Остатки · Резервы · История</span>
            </footer>
          </div>
        </div>
      </Show>
    </Show>
  );
}
/** Keyed workspace сбрасывает формы/selection при смене склада; query keys дополнительно разделяют cache. */
function WorkspaceContent() {
  const w = useWorkspace(),
    location = useLocation(),
    queries = useQueryClient();
  return (
    <>
      <Recovery
        warehouseId={w.warehouse()}
        disabled={w.busy()}
        onRecovered={() => {
          queries.invalidateQueries({ queryKey: ['private'] }).catch(w.setError);
          w.setNotice('Результат сохранённой команды получен. Данные обновлены.');
        }}
      />
      <ErrorNotice error={w.error()} />
      <Show when={w.notice()}>
        <p class="notice success" role="status">
          {w.notice()}
        </p>
      </Show>
      <div class="directory-more">
        <Show when={w.moreProducts()}>
          <button class="ghost" onClick={w.loadProducts}>
            Загрузить ещё товары
          </button>
        </Show>
        <Show when={w.moreLocations()}>
          <button class="ghost" onClick={w.loadLocations}>
            Загрузить ещё ячейки
          </button>
        </Show>
      </div>
      <Switch
        fallback={
          <section class="panel">
            <h1>Страница не найдена</h1>
            <A href="/">К остаткам</A>
          </section>
        }
      >
        <Match when={location.pathname === '/'}>
          <StockPage />
        </Match>
        <Match when={location.pathname === '/receipts'}>
          <ReceivingPage />
        </Match>
        <Match when={location.pathname === '/putaway'}>
          <PutawayPage />
        </Match>
        <Match when={location.pathname === '/orders'}>
          <OrdersPage />
        </Match>
        <Match when={location.pathname === '/picking'}>
          <PickingPage />
        </Match>
        <Match when={location.pathname === '/shipments'}>
          <ShippingPage />
        </Match>
        <Match when={location.pathname === '/history'}>
          <HistoryPage />
        </Match>
      </Switch>
    </>
  );
}
