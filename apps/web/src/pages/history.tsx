/** @file История: отдельные scoped lists movements/audit, закрытые фильтры и cursor; audit требует право API. */
import { createSignal, For, Show } from 'solid-js';
import { useWorkspace } from '../data/workspace';
import { useWarehouseList } from '../data/queries';
import { Collection } from '../components/collection';
import { Field } from '../components/ui';
/** Нет raw audit changes или произвольного HTML; значения рендерит Solid как текст. */
export function HistoryPage() {
  const w = useWorkspace();
  const [tab, setTab] = createSignal('movements'),
    [correlation, setCorrelation] = createSignal('');
  const movements = useWarehouseList('movements', w.warehouse);
  const audit = useWarehouseList(
    'audit',
    w.warehouse,
    (): Record<string, string> => (correlation() ? { correlationId: correlation() } : {}),
    () => tab() === 'audit',
  );
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ПРОЗРАЧНОСТЬ ОПЕРАЦИЙ</p>
          <h1>История</h1>
          <p class="muted">Движения объясняют количество. Аудит объясняет действия.</p>
        </div>
      </div>
      <section class="panel">
        <div class="actions">
          <button
            class={tab() === 'movements' ? '' : 'secondary'}
            onClick={() => setTab('movements')}
          >
            Движения
          </button>
          <button class={tab() === 'audit' ? '' : 'secondary'} onClick={() => setTab('audit')}>
            Аудит
          </button>
        </div>
        <Show
          when={tab() === 'movements'}
          fallback={
            <>
              <form
                class="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setCorrelation(String(new FormData(e.currentTarget).get('correlation') ?? ''));
                }}
              >
                <Field label="Correlation ID" id="history-correlation">
                  <input
                    id="history-correlation"
                    name="correlation"
                    placeholder="UUID или пустое поле"
                  />
                </Field>
                <button class="secondary">Применить фильтр</button>
              </form>
              <Collection
                items={audit.data?.pages.flatMap((p) => p.items) ?? []}
                loading={audit.isPending}
                error={audit.error}
                more={audit.hasNextPage}
                fetching={audit.isFetching}
                onMore={() => {
                  audit.fetchNextPage().catch(w.setError);
                }}
              >
                {(entry) => (
                  <article class="history-row">
                    <strong>{entry.action}</strong>
                    <span>
                      {entry.entityType} #{entry.entityId.slice(0, 8)}
                    </span>
                    <small>
                      {new Date(entry.occurredAt).toLocaleString('ru')} · основание{' '}
                      {entry.reasonCode}
                    </small>
                    <code>{entry.correlationId}</code>
                  </article>
                )}
              </Collection>
            </>
          }
        >
          <Collection
            items={movements.data?.pages.flatMap((p) => p.items) ?? []}
            loading={movements.isPending}
            error={movements.error}
            more={movements.hasNextPage}
            fetching={movements.isFetching}
            onMore={() => {
              movements.fetchNextPage().catch(w.setError);
            }}
          >
            {(m) => (
              <article class="history-row">
                <strong>
                  {
                    {
                      receipt: 'Приход',
                      'transfer-out': 'Перенос из ячейки',
                      'transfer-in': 'Перенос в ячейку',
                      shipment: 'Отгрузка',
                    }[m.kind]
                  }{' '}
                  · {m.quantity} шт.
                </strong>
                <span>
                  {w.productLabel(m.productId)} / {w.locationLabel(m.locationId)}
                </span>
                <small>
                  {new Date(m.createdAt).toLocaleString('ru')} · audit #{m.auditId.slice(0, 8)}
                </small>
              </article>
            )}
          </Collection>
        </Show>
      </section>
    </>
  );
}
