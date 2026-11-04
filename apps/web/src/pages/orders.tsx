/** @file Заказы: создание, explicit reserve/release, picking/shipment и B3 возврат — отдельные server команды. */
import { createSignal, For, Show } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { useSession } from '../session/session';
import { useWorkspace } from '../data/workspace';
import { useWarehouseList } from '../data/queries';
import { ReserveForm } from '../components/reserve-form';
import { DraftForm } from '../components/draft-form';
import { Collection } from '../components/collection';
import { Field, Status, ErrorNotice } from '../components/ui';
import type { Schema } from '../api/client';
/** Исполнение qty/state/locks остаётся API; клиент только отображает DTO и собирает явный вектор. */
export function OrdersPage() {
  const session = useSession(),
    w = useWorkspace();
  const [id, setId] = createSignal('');
  const list = useWarehouseList('orders', w.warehouse);
  const order = createQuery(() => ({
    queryKey: ['private', session.user()?.user.id, w.warehouse(), 'order', id()],
    enabled: !!id(),
    queryFn: ({ signal }) =>
      session.api.get('/api/v1/orders/{orderId}', { orderId: id() }, {}, signal),
    retry: false,
  }));
  const createDraft = async (lines: { productId: string; quantity: number }[]) => {
    const r = await w.send('Создание заказа', '/api/v1/orders', {
      warehouseId: w.warehouse(),
      lines,
    });
    if (r) setId(r.id);
    return !!r;
  };
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ИСХОДЯЩИЙ ПОТОК</p>
          <h1>Заказы</h1>
          <p class="muted">Резервирование, сборка и подготовка к отгрузке.</p>
        </div>
      </div>
      <div class="columns">
        <DraftForm kind="order" onCreate={createDraft} />
        <section class="panel">
          <h2>Документы заказов</h2>
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
            {(o) => (
              <button type="button" class="document-row" onClick={() => setId(o.id)}>
                <span>Заказ #{o.id.slice(0, 8)}</span>
                <Status value={o.status} />
              </button>
            )}
          </Collection>
        </section>
      </div>
      <ErrorNotice error={order.error} />
      <Show when={order.error ? undefined : order.data}>{(o) => <OrderDetail order={o()} />}</Show>
    </>
  );
}
/** Detail не копирует агрегат в локальный store; после команды server DTO перечитывается invalidation. */
function OrderDetail(props: { order: Schema['OrderDto'] }) {
  const w = useWorkspace();
  const command = (action: 'confirm' | 'cancel') => {
    w.send(
      action === 'confirm' ? 'Подтверждение заказа' : 'Отмена заказа',
      action === 'confirm' ? '/api/v1/orders/{orderId}/confirm' : '/api/v1/orders/{orderId}/cancel',
      {},
      { orderId: props.order.id },
    ).catch(w.setError);
  };
  const prepareShipment = async (event: SubmitEvent) => {
    event.preventDefault();
    const d = new FormData(event.currentTarget as HTMLFormElement);
    const lines = props.order.lines
      .flatMap((l) => l.allocations)
      .filter((a) => a.locationKind === 'shipping' && a.active > 0 && d.has(`select-${a.id}`))
      .map((a) => ({ allocationId: a.id, quantity: Number(d.get(`qty-${a.id}`)) }));
    await w.send(
      'Подготовка отгрузки',
      '/api/v1/orders/{orderId}/shipments',
      { reasonCode: String(d.get('reasonCode')), lines },
      { orderId: props.order.id },
    );
  };
  const completeReturn = async (event: SubmitEvent) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await w.send(
      'Физический возврат',
      '/api/v1/orders/{orderId}/cancellation-return',
      {
        reasonCode: String(data.get('reasonCode')),
        lines: props.order.lines
          .filter((l) => l.reservedShipping > 0)
          .map((l) => ({
            lineId: l.id,
            quantity: l.reservedShipping,
            targetLocationId: String(data.get('target')),
          })),
      },
      { orderId: props.order.id },
    );
  };
  return (
    <section class="panel detail">
      <div class="section-heading">
        <h2>Заказ #{props.order.id.slice(0, 8)}</h2>
        <Status value={props.order.status} />
      </div>
      <For each={props.order.lines}>
        {(line) => (
          <article class="line-card">
            <strong>
              {w.productLabel(line.productId)} · заказано {line.quantity}
            </strong>
            <p>
              Открыто: {line.open} · резерв в хранении: {line.reservedStorage} · подготовлено:{' '}
              {line.reservedShipping} · отгружено: {line.shipped} · отменено: {line.cancelled}
            </p>
            <For
              each={line.allocations.filter((a) => a.active > 0 && a.locationKind === 'storage')}
            >
              {(allocation) => (
                <form
                  class="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    w.send(
                      'Освобождение резерва',
                      '/api/v1/orders/{orderId}/allocations/{allocationId}/release',
                      { quantity: Number(d.get('quantity')) },
                      { orderId: props.order.id, allocationId: allocation.id },
                    ).catch(w.setError);
                  }}
                >
                  <Field
                    label={`Освободить из ${w.locationLabel(allocation.locationId)}`}
                    id={`release-${allocation.id}`}
                  >
                    <input
                      id={`release-${allocation.id}`}
                      name="quantity"
                      type="number"
                      min="1"
                      max={allocation.active}
                      step="1"
                      value={allocation.active}
                      required
                    />
                  </Field>
                  <button class="secondary" disabled={w.busy() || props.order.status !== 'active'}>
                    Освободить резерв
                  </button>
                </form>
              )}
            </For>
          </article>
        )}
      </For>
      <div class="actions">
        <Show when={props.order.status === 'draft'}>
          <button disabled={w.busy()} onClick={() => command('confirm')}>
            Подтвердить заказ
          </button>
        </Show>
        <Show when={props.order.status === 'active'}>
          <button
            class="secondary"
            disabled={w.busy()}
            onClick={() => {
              w.send(
                'Создание задания сборки',
                '/api/v1/orders/{orderId}/picking-tasks',
                {},
                { orderId: props.order.id },
              ).catch(w.setError);
            }}
          >
            Создать задание сборки
          </button>
        </Show>
        <Show when={props.order.status === 'draft' || props.order.status === 'active'}>
          <button class="danger" disabled={w.busy()} onClick={() => command('cancel')}>
            Отменить заказ
          </button>
        </Show>
      </div>
      <Show when={props.order.status === 'active' && props.order.lines.some((l) => l.open > 0)}>
        <ReserveForm order={props.order} />
      </Show>
      <Show
        when={
          props.order.status === 'active' && props.order.lines.some((l) => l.reservedShipping > 0)
        }
      >
        <form
          class="subpanel"
          onSubmit={(e) => {
            prepareShipment(e).catch(w.setError);
          }}
        >
          <h3>Подготовить отгрузку</h3>
          <p class="muted">
            Можно выбрать часть подготовленного товара. Черновик не резервирует его повторно.
          </p>
          <Field label="Основание отгрузки" id="shipment-reason">
            <input
              id="shipment-reason"
              name="reasonCode"
              value="customer-dispatch"
              pattern="[a-z][a-z0-9.-]{2,63}"
              required
            />
          </Field>
          <For each={props.order.lines}>
            {(line) => (
              <For
                each={line.allocations.filter((a) => a.locationKind === 'shipping' && a.active > 0)}
              >
                {(a) => (
                  <div class="form-row">
                    <label>
                      <input type="checkbox" name={`select-${a.id}`} checked />
                      {w.productLabel(line.productId)} / {w.locationLabel(a.locationId)}
                    </label>
                    <Field label="Количество к отгрузке" id={`shipqty-${a.id}`}>
                      <input
                        id={`shipqty-${a.id}`}
                        name={`qty-${a.id}`}
                        type="number"
                        min="1"
                        max={a.active}
                        step="1"
                        value={a.active}
                        required
                      />
                    </Field>
                  </div>
                )}
              </For>
            )}
          </For>
          <button disabled={w.busy()}>Создать отгрузку</button>
        </form>
      </Show>
      <Show when={props.order.status === 'cancel_pending'}>
        <form
          class="subpanel"
          onSubmit={(e) => {
            completeReturn(e).catch(w.setError);
          }}
        >
          <h3>Возврат при отмене</h3>
          <p>
            Верните весь неотгруженный товар из зоны отгрузки в хранение. Отгруженное количество
            сохраняется.
          </p>
          <Field label="Ячейка возврата в хранение" id="return-target">
            <select id="return-target" name="target" required>
              <option value="">Выберите ячейку</option>
              <For each={w.locations().filter((l) => l.kind === 'storage')}>
                {(l) => <option value={l.id}>{l.code}</option>}
              </For>
            </select>
          </Field>
          <Field label="Основание возврата" id="return-reason">
            <input
              id="return-reason"
              name="reasonCode"
              value="customer-cancelled"
              pattern="[a-z][a-z0-9.-]{2,63}"
              required
            />
          </Field>
          <label class="check">
            <input type="checkbox" required />
            Весь неотгруженный товар физически возвращён
          </label>
          <button disabled={w.busy()}>Подтвердить полный возврат</button>
        </form>
      </Show>
    </section>
  );
}
