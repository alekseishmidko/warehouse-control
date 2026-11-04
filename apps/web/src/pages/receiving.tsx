/** @file Приёмка: список и detail из API, create/post с общим command journal; worker ожидание показано отдельно. */
import { createSignal, For, Show } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { useSession } from '../session/session';
import { useWorkspace } from '../data/workspace';
import { useWarehouseList } from '../data/queries';
import { Collection } from '../components/collection';
import { DraftForm } from '../components/draft-form';
import { Status, ErrorNotice } from '../components/ui';
/** Новый key на posted не создаётся: UI скрывает post, recovery работает с сохранённым key. */
export function ReceivingPage() {
  const session = useSession(),
    workspace = useWorkspace();
  const [id, setId] = createSignal('');
  const list = useWarehouseList('receipts', workspace.warehouse);
  const document = createQuery(() => ({
    queryKey: ['private', session.user()?.user.id, workspace.warehouse(), 'receipt', id()],
    enabled: !!id(),
    queryFn: ({ signal }) =>
      session.api.get('/api/v1/receipts/{receiptId}', { receiptId: id() }, {}, signal),
    retry: false,
  }));
  const createDraft = async (
    lines: { productId: string; quantity: number }[],
    locationId: string,
  ) => {
    const r = await workspace.send('Создание приёмки', '/api/v1/receipts', {
      warehouseId: workspace.warehouse(),
      receivingLocationId: locationId,
      lines,
    });
    if (r) setId(r.id);
    return !!r;
  };
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ВХОДЯЩИЙ ПОТОК</p>
          <h1>Приёмка товара</h1>
          <p class="muted">Примите товар, затем передайте его на размещение.</p>
        </div>
      </div>
      <div class="columns">
        <DraftForm kind="receipt" onCreate={createDraft} />
        <section class="panel">
          <h2>Документы приёмки</h2>
          <Collection
            items={list.data?.pages.flatMap((p) => p.items) ?? []}
            loading={list.isPending}
            error={list.error}
            more={list.hasNextPage}
            fetching={list.isFetching}
            onMore={() => {
              list.fetchNextPage().catch(workspace.setError);
            }}
          >
            {(r) => (
              <button type="button" class="document-row" onClick={() => setId(r.id)}>
                <span>
                  Приёмка #{r.id.slice(0, 8)}
                  <small>{new Date(r.createdAt).toLocaleString('ru')}</small>
                </span>
                <Status value={r.status} />
              </button>
            )}
          </Collection>
        </section>
      </div>
      <ErrorNotice error={document.error} />
      <Show when={document.error ? undefined : document.data}>
        {(d) => (
          <section class="panel detail">
            <div class="section-heading">
              <h2>Приёмка #{d().id.slice(0, 8)}</h2>
              <Status value={d().status} />
            </div>
            <For each={d().lines}>
              {(line) => (
                <div class="quantity-row">
                  <span>{workspace.productLabel(line.productId)}</span>
                  <strong>{line.quantity} шт.</strong>
                </div>
              )}
            </For>
            <Show when={d().status === 'draft'}>
              <button
                disabled={workspace.busy()}
                onClick={() => {
                  workspace
                    .send(
                      'Проведение приёмки',
                      '/api/v1/receipts/{receiptId}/post',
                      {},
                      { receiptId: d().id },
                    )
                    .catch(workspace.setError);
                }}
              >
                Провести приёмку
              </button>
            </Show>
            <Show when={d().status === 'posted'}>
              <p class="notice">
                Товар принят. Задания появятся в разделе «Размещение» после обработки worker.
                Завершение обработки ещё не означает физическое размещение.
              </p>
            </Show>
          </section>
        )}
      </Show>
    </>
  );
}
