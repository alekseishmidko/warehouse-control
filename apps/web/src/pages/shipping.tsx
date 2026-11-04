/** @file Shipment: чтение immutable состава, posting целиком и отмена draft с reason; никакого optimistic списания. */
import { createSignal, For, Show } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { useSession } from '../session/session';
import { useWorkspace } from '../data/workspace';
import { useWarehouseList } from '../data/queries';
import { Collection } from '../components/collection';
import { Status, ErrorNotice, Field } from '../components/ui';
/** Partial shipment выбирается при prepare в заказе; post всегда подтверждает весь сохранённый документ. */
export function ShippingPage() {
  const s = useSession(),
    w = useWorkspace();
  const [id, setId] = createSignal('');
  const list = useWarehouseList('shipments', w.warehouse);
  const shipment = createQuery(() => ({
    queryKey: ['private', s.user()?.user.id, w.warehouse(), 'shipment', id()],
    enabled: !!id(),
    queryFn: ({ signal }) =>
      s.api.get('/api/v1/shipments/{shipmentId}', { shipmentId: id() }, {}, signal),
    retry: false,
  }));
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ИСХОДЯЩИЙ ПОТОК</p>
          <h1>Отгрузка</h1>
          <p class="muted">Черновики создаются в заказе из подготовленного товара.</p>
        </div>
      </div>
      <section class="panel">
        <Collection
          items={list.data?.pages.flatMap((p) => p.items) ?? []}
          loading={list.isPending}
          error={list.error}
          more={list.hasNextPage}
          fetching={list.isFetching}
          onMore={() => {
            list.fetchNextPage().catch(w.setError);
          }}
        >
          {(d) => (
            <button type="button" class="document-row" onClick={() => setId(d.id)}>
              <span>
                Отгрузка #{d.id.slice(0, 8)}
                <small>Заказ #{d.orderId.slice(0, 8)}</small>
              </span>
              <Status value={d.status} />
            </button>
          )}
        </Collection>
      </section>
      <ErrorNotice error={shipment.error} />
      <Show when={shipment.error ? undefined : shipment.data}>
        {(d) => (
          <section class="panel detail">
            <div class="section-heading">
              <h2>Отгрузка #{d().id.slice(0, 8)}</h2>
              <Status value={d().status} />
            </div>
            <p>Основание: {d().reasonCode}</p>
            <For each={d().lines}>
              {(line) => (
                <div class="quantity-row">
                  <span>Партия резерва #{line.allocationId.slice(0, 8)}</span>
                  <strong>{line.quantity} шт.</strong>
                </div>
              )}
            </For>
            <Show when={d().status === 'draft'}>
              <div class="actions">
                <button
                  disabled={w.busy()}
                  onClick={() => {
                    w.send(
                      'Подтверждение отгрузки',
                      '/api/v1/shipments/{shipmentId}/post',
                      {},
                      { shipmentId: d().id },
                    ).catch(w.setError);
                  }}
                >
                  Подтвердить отгрузку
                </button>
              </div>
              <form
                class="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  w.send(
                    'Отмена черновика отгрузки',
                    '/api/v1/shipments/{shipmentId}/cancel',
                    { reasonCode: String(data.get('reasonCode')) },
                    { shipmentId: d().id },
                  ).catch(w.setError);
                }}
              >
                <Field label="Основание отмены черновика" id="shipment-cancel-reason">
                  <input
                    id="shipment-cancel-reason"
                    name="reasonCode"
                    value="dispatch-cancelled"
                    pattern="[a-z][a-z0-9.-]{2,63}"
                    required
                  />
                </Field>
                <button class="secondary" disabled={w.busy()}>
                  Отменить черновик отгрузки
                </button>
              </form>
            </Show>
          </section>
        )}
      </Show>
    </>
  );
}
