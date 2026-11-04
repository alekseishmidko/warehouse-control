/** @file AC-208-02/05/06: reactive scope и form preservation проверяются на настоящих Solid Router/Query/Session компонентах. */
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createWarehouseQueryClient } from '../src/data/query-client';
import { SessionProvider } from '../src/session/session';
import { App } from '../src/pages/app';
import type { Schema } from '../src/api/client';
const warehouse = crypto.randomUUID(),
  other = crypto.randomUUID(),
  user = crypto.randomUUID(),
  product = crypto.randomUUID(),
  orderId = crypto.randomUUID(),
  lineId = crypto.randomUUID(),
  allocationId = crypto.randomUUID();
const current: Schema['CurrentUserDto'] = {
  user: { id: user, login: 'operator', active: true, systemAdmin: false },
  csrfToken: 'a'.repeat(43),
  warehouseRoles: [{ warehouseId: warehouse, role: 'warehouse_supervisor' }],
};
const order: Schema['OrderDto'] = {
  id: orderId,
  warehouseId: warehouse,
  status: 'active',
  lines: [
    {
      id: lineId,
      productId: product,
      quantity: 2,
      open: 0,
      reservedStorage: 0,
      reservedShipping: 2,
      shipped: 0,
      cancelled: 0,
      allocations: [
        {
          id: allocationId,
          balanceId: crypto.randomUUID(),
          locationId: crypto.randomUUID(),
          locationKind: 'shipping',
          allocated: 2,
          active: 2,
          released: 0,
          transferred: 0,
          consumed: 0,
          state: 'active',
        },
      ],
    },
  ],
};
/** Fixture — заданные ответы API, а не копия алгоритмов reserve/pick/ship. Запросы по-прежнему проходят ApiClient. */
function mount(
  directory?: { wait: Promise<void>; denyProducts: boolean },
  loseDraftResponse = false,
) {
  const posts: { path: string; body: unknown }[] = [];
  let draftCreated = false;
  let responseLost = false;
  const draft: Schema['OrderDto'] = {
    ...order,
    id: crypto.randomUUID(),
    status: 'draft',
    lines: [
      {
        ...order.lines[0],
        id: crypto.randomUUID(),
        open: 2,
        reservedStorage: 0,
        reservedShipping: 0,
        allocations: [],
      },
    ],
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    let data: unknown = { items: [], nextCursor: null };
    if (path === '/api/v1/auth/me') data = current;
    else if (path === '/api/v1/warehouses')
      data = {
        items: [
          { id: warehouse, code: 'ONE', name: 'Склад один' },
          { id: other, code: 'TWO', name: 'Склад два' },
        ],
        nextCursor: null,
      };
    else if (path.endsWith('/products')) {
      if (directory) {
        await directory.wait;
        if (directory.denyProducts) return new Response('{"code":"FORBIDDEN"}', { status: 403 });
      }
      data = {
        items: directory ? [] : [{ id: product, sku: 'SKU-ONE', name: 'Товар', unit: 'piece' }],
        nextCursor: null,
      };
    } else if (path.endsWith('/locations')) {
      if (directory) await directory.wait;
      data = { items: [], nextCursor: null };
    } else if (path.endsWith('/balances'))
      data = {
        items: [
          {
            id: crypto.randomUUID(),
            warehouseId: path.includes(other) ? other : warehouse,
            productId: product,
            locationId: crypto.randomUUID(),
            locationKind: 'storage',
            onHand: path.includes(other) ? 20 : 10,
            reserved: 0,
            available: path.includes(other) ? 20 : 10,
          },
        ],
        nextCursor: null,
      };
    else if (path.endsWith('/orders'))
      data = {
        items: [
          { id: orderId, warehouseId: warehouse, status: 'active' },
          ...(draftCreated ? [{ id: draft.id, warehouseId: warehouse, status: 'draft' }] : []),
        ],
        nextCursor: null,
      };
    else if (path === `/api/v1/orders/${orderId}`) data = order;
    else if (path === `/api/v1/orders/${draft.id}`) data = draft;
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) as unknown });
      if (path === '/api/v1/orders') {
        draftCreated = true;
        data = draft;
        // Однократный сетевой отказ после изменения синтетического API state. SQL commit/lost response
        // проверяет настоящий browser gate; здесь проверяется сохранение локального состояния формы.
        if (loseDraftResponse && !responseLost) {
          responseLost = true;
          throw new Error('Lost draft response');
        }
      } else data = { id: crypto.randomUUID() };
    }
    return new Response(JSON.stringify(data));
  });
  const queries = createWarehouseQueryClient();
  render(() => (
    <QueryClientProvider client={queries}>
      <SessionProvider>
        <MemoryRouter>
          <Route path="/*" component={App} />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  ));
  return { queries, posts };
}
it('refetch of identical DTO never replaces user-entered shipment quantity', async () => {
  const { queries, posts } = mount();
  await screen.findByRole('heading', { name: 'Выберите склад' });
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  fireEvent.click(screen.getByRole('link', { name: 'Заказы' }));
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(`Заказ #${orderId.slice(0, 8)}`) }),
  );
  const quantity = await screen.findByLabelText('Количество к отгрузке');
  fireEvent.input(quantity, { target: { value: '1' } });
  await queries.invalidateQueries({ queryKey: ['private'] });
  expect((screen.getByLabelText('Количество к отгрузке') as HTMLInputElement).value).toBe('1');
  fireEvent.submit(screen.getByRole('button', { name: 'Создать отгрузку' }).closest('form')!);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].body).toMatchObject({ lines: [{ allocationId, quantity: 1 }] });
});
it('warehouse change uses another query key and shows only the selected warehouse data', async () => {
  const { queries } = mount();
  await screen.findByRole('heading', { name: 'Выберите склад' });
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  await screen.findByRole('row', { name: /SKU-ONE.*10.*0.*10/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: other } });
  await screen.findByRole('row', { name: /SKU-ONE.*20.*0.*20/ });
  expect(screen.queryByRole('row', { name: /SKU-ONE.*10.*0.*10/ })).toBeNull();
  expect(
    queries
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.includes(warehouse)),
  ).toBe(true);
  expect(
    queries
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.includes(other)),
  ).toBe(true);
});

it('pending command from another warehouse cannot be replayed under the current workspace', async () => {
  sessionStorage.setItem(
    `wms-pending-v1:${user}`,
    JSON.stringify({
      version: 1,
      userId: user,
      warehouseId: warehouse,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: '/api/v1/orders',
      body: '{}',
      label: 'Создание заказа',
    }),
  );
  mount();
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: other } });
  const replay = await screen.findByRole('button', {
    name: 'Проверить результат с прежним ключом',
  });
  expect((replay as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Проверить результат с прежним ключом',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});

it('successful create cannot be submitted again until a new draft is explicitly requested', async () => {
  const { posts } = mount();
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  fireEvent.click(screen.getByRole('link', { name: 'Заказы' }));
  await screen.findByRole('option', { name: 'SKU-ONE — Товар' });
  fireEvent.change(screen.getByLabelText('Товар 1'), { target: { value: product } });
  fireEvent.input(screen.getByLabelText('Количество 1'), { target: { value: '2' } });
  const button = await screen.findByRole('button', { name: 'Создать черновик' });
  const form = button.closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(posts).toHaveLength(1));
  await screen.findByRole('button', { name: 'Новый черновик' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(form);
  expect(posts).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Новый черновик' }));
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

it('recovered draft creation still requires explicit new draft after page reload', async () => {
  // Snapshot имитирует сохранённую команду до reload. Recovery возвращает результат,
  // но исходная форма не должна снова стать новой операцией с другим ключом.
  sessionStorage.setItem(
    `wms-pending-v1:${user}`,
    JSON.stringify({
      version: 1,
      userId: user,
      warehouseId: warehouse,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: '/api/v1/orders',
      body: JSON.stringify({
        warehouseId: warehouse,
        lines: [{ productId: product, quantity: 2 }],
      }),
      label: 'Создание заказа',
    }),
  );
  const { posts } = mount();
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  fireEvent.click(screen.getByRole('link', { name: 'Заказы' }));
  const button = await screen.findByRole('button', { name: 'Создать черновик' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить результат с прежним ключом' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Проверить результат с прежним ключом' }),
    ).toBeNull(),
  );
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(button.closest('form')!);
  expect(posts).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Новый черновик' }));
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

it('lost create response locks the original form through recovery without reload', async () => {
  const { posts } = mount(undefined, true);
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  fireEvent.click(screen.getByRole('link', { name: 'Заказы' }));
  await screen.findByRole('option', { name: 'SKU-ONE — Товар' });
  fireEvent.change(screen.getByLabelText('Товар 1'), { target: { value: product } });
  const button = screen.getByRole('button', { name: 'Создать черновик' });
  fireEvent.submit(button.closest('form')!);
  const replay = await screen.findByRole('button', {
    name: 'Проверить результат с прежним ключом',
  });
  await waitFor(() => expect((replay as HTMLButtonElement).disabled).toBe(false));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(replay);
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Проверить результат с прежним ключом' }),
    ).toBeNull(),
  );
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(button.closest('form')!);
  expect(posts).toHaveLength(2); // Первичная отправка и явный replay; третьей команды с новым key нет.
});

it.each([
  { savedWarehouse: warehouse, url: '/api/v1/receipts', page: 'Приёмка', locked: true },
  { savedWarehouse: other, url: '/api/v1/orders', page: 'Заказы', locked: false },
  {
    savedWarehouse: warehouse,
    url: `/api/v1/orders/${orderId}/reserve`,
    page: 'Заказы',
    locked: false,
  },
])('draft lock belongs only to its create URL and warehouse: $page/$url/$locked', async (item) => {
  sessionStorage.setItem(
    `wms-pending-v1:${user}`,
    JSON.stringify({
      version: 1,
      userId: user,
      warehouseId: item.savedWarehouse,
      key: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      url: item.url,
      body: '{}',
      label: 'Сохранённая команда',
    }),
  );
  mount();
  await screen.findByRole('option', { name: /Склад один/ });
  fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
  fireEvent.click(screen.getByRole('link', { name: item.page }));
  const button = await screen.findByRole('button', { name: 'Создать черновик' });
  expect((button as HTMLButtonElement).disabled).toBe(item.locked);
});

it('skip link actually moves focus into main content', async () => {
  mount();
  const link = await screen.findByRole('link', { name: 'Перейти к содержимому' });
  link.focus();
  fireEvent.click(link);
  expect(document.activeElement).toBe(document.getElementById('main-content'));
});

it('directories distinguish pending, empty and denied reads before forms are usable', async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const directory = { wait, denyProducts: false };
  const { queries } = mount(directory);
  await screen.findByRole('option', { name: /Склад один/ });
  // Barrier удерживает только справочные ответы. Loading проверяется до release, без случайного sleep.
  try {
    fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
    await screen.findByText('Загружаем товары и ячейки…');
  } finally {
    release();
  }
  await screen.findByText('В справочнике нет товаров. Обратитесь к администратору.');
  await screen.findByText('На складе нет ячеек. Обратитесь к администратору.');
  expect(screen.queryByText('Загружаем товары и ячейки…')).toBeNull();
  // После успешной пустой страницы новый 403 должен показывать ошибку, а не прежнее empty состояние.
  directory.denyProducts = true;
  await queries.invalidateQueries({ queryKey: ['private'] });
  await screen.findByRole('alert');
  expect(screen.queryByText('В справочнике нет товаров. Обратитесь к администратору.')).toBeNull();
});

it('blocked sessionStorage getter does not prevent login or read-only workspace', async () => {
  const getter = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  try {
    const { posts } = mount();
    await screen.findByRole('option', { name: /Склад один/ });
    fireEvent.change(screen.getByLabelText('Текущий склад'), { target: { value: warehouse } });
    await screen.findByRole('row', { name: /SKU-ONE.*10.*0.*10/ });
    fireEvent.click(screen.getByRole('link', { name: 'Заказы' }));
    await screen.findByRole('option', { name: 'SKU-ONE — Товар' });
    fireEvent.change(screen.getByLabelText('Товар 1'), { target: { value: product } });
    fireEvent.submit(screen.getByRole('button', { name: 'Создать черновик' }).closest('form')!);
    await screen.findByText(/Команда не отправлена/);
    expect(posts).toHaveLength(0);
  } finally {
    getter.mockRestore();
  }
});
