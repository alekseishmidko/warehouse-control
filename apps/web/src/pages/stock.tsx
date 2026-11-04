/** @file Остатки и доступность: серверный available, totals только по загруженным строкам; filters входят в query key. */
import { createSignal, For, Show } from 'solid-js';
import { useWorkspace } from '../data/workspace';
import { useWarehouseList } from '../data/queries';
import { Field, DataTable, ErrorNotice } from '../components/ui';
/** Нет клиентского резервирования или локальной копии остатков после mutations. */
export function StockPage() {
  const w = useWorkspace();
  const [kind, setKind] = createSignal(''),
    [product, setProduct] = createSignal('');
  const list = useWarehouseList('balances', w.warehouse, () => ({
    ...(kind() ? { locationKind: kind() } : {}),
    ...(product() ? { productId: product() } : {}),
  }));
  const rows = () => (list.error ? [] : (list.data?.pages.flatMap((p) => p.items) ?? []));
  const sum = (field: 'onHand' | 'reserved' | 'available') =>
    rows().reduce((n, row) => n + row[field], 0);
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ОБЗОР СКЛАДА</p>
          <h1>Остатки и доступность</h1>
          <p class="muted">Актуальный учёт по товарам и ячейкам.</p>
        </div>
        <button class="secondary" onClick={w.refresh}>
          Обновить остатки
        </button>
      </div>
      <div class="metrics">
        <article>
          <span>В наличии</span>
          <strong>
            {list.error ? '—' : list.isPending ? '…' : sum('onHand')}
            <small> шт.</small>
          </strong>
        </article>
        <article>
          <span>В резерве</span>
          <strong>
            {list.error ? '—' : list.isPending ? '…' : sum('reserved')}
            <small> шт.</small>
          </strong>
        </article>
        <article>
          <span>Свободно</span>
          <strong>
            {list.error ? '—' : list.isPending ? '…' : sum('available')}
            <small> шт.</small>
          </strong>
        </article>
      </div>
      <p class="muted small">
        Суммы по загруженным позициям. Свободный товар доступен для резервирования только в зоне
        хранения.
      </p>
      <section class="panel">
        <div class="filters">
          <Field label="Зона" id="stock-kind">
            <select id="stock-kind" value={kind()} onChange={(e) => setKind(e.currentTarget.value)}>
              <option value="">Все зоны</option>
              <option value="receiving">Приёмка</option>
              <option value="storage">Хранение</option>
              <option value="shipping">Отгрузка</option>
            </select>
          </Field>
          <Field label="Товар" id="stock-product">
            <select
              id="stock-product"
              value={product()}
              onChange={(e) => setProduct(e.currentTarget.value)}
            >
              <option value="">Все товары</option>
              <For each={w.products()}>{(p) => <option value={p.id}>{p.sku}</option>}</For>
            </select>
          </Field>
        </div>
        <ErrorNotice error={list.error} />
        <p role="status">{list.isPending ? 'Загрузка остатков…' : ''}</p>
        <Show when={!list.error && !list.isPending}>
          <DataTable
            headers={['Товар', 'Ячейка', 'Зона', 'В наличии', 'В резерве', 'Свободно']}
            empty={!rows().length}
          >
            <For each={rows()}>
              {(row) => (
                <tr>
                  <th scope="row">{w.productLabel(row.productId)}</th>
                  <td>{w.locationLabel(row.locationId)}</td>
                  <td>
                    {
                      { receiving: 'Приёмка', storage: 'Хранение', shipping: 'Отгрузка' }[
                        row.locationKind
                      ]
                    }
                  </td>
                  <td>{row.onHand}</td>
                  <td>{row.reserved}</td>
                  <td>{row.available}</td>
                </tr>
              )}
            </For>
          </DataTable>
        </Show>
        <button
          type="button"
          class="secondary more"
          hidden={!list.hasNextPage}
          disabled={list.isFetching}
          onClick={() => {
            list.fetchNextPage().catch(w.setError);
          }}
        >
          Загрузить ещё
        </button>
      </section>
    </>
  );
}
