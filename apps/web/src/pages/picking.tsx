/** @file Сборка: самоназначение и подтверждение фактического приращения; нехватка не списывает остаток. */
import { createSignal, For, Show } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { useSession } from '../session/session';
import { useWorkspace } from '../data/workspace';
import { useWarehouseList } from '../data/queries';
import { Collection } from '../components/collection';
import { Field, Status, ErrorNotice } from '../components/ui';
/** Права исполнителя проверяются API повторно, скрытая кнопка не считается авторизацией. */
export function PickingPage() {
  const s = useSession(),
    w = useWorkspace();
  const [id, setId] = createSignal('');
  const list = useWarehouseList('picking-tasks', w.warehouse);
  const task = createQuery(() => ({
    queryKey: ['private', s.user()?.user.id, w.warehouse(), 'picking', id()],
    enabled: !!id(),
    queryFn: ({ signal }) =>
      s.api.get('/api/v1/picking-tasks/{taskId}', { taskId: id() }, {}, signal),
    retry: false,
  }));
  const order = createQuery(() => ({
    queryKey: ['private', s.user()?.user.id, w.warehouse(), 'order', task.data?.orderId],
    enabled: !!task.data?.orderId,
    queryFn: ({ signal }) =>
      s.api.get('/api/v1/orders/{orderId}', { orderId: task.data!.orderId }, {}, signal),
    retry: false,
  }));
  const productFor = (allocationId: string) =>
    order.data?.lines.find((line) => line.allocations.some((a) => a.id === allocationId))
      ?.productId;
  const confirm = async (event: SubmitEvent, lineId: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement),
      actualQuantity = Number(data.get('quantity'));
    await w.send(
      'Подтверждение сборки',
      '/api/v1/picking-tasks/{taskId}/confirm',
      {
        taskLineId: lineId,
        actualQuantity,
        shortage: data.has('shortage'),
        ...(actualQuantity > 0 ? { targetLocationId: String(data.get('target')) } : {}),
      },
      { taskId: id() },
    );
  };
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ИСПОЛНЕНИЕ ЗАКАЗА</p>
          <h1>Сборка</h1>
          <p class="muted">Примите задание и подтвердите фактически собранное количество.</p>
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
          {(t) => (
            <button type="button" class="document-row" onClick={() => setId(t.id)}>
              <span>
                Сборка #{t.id.slice(0, 8)}
                <small>Заказ #{t.orderId.slice(0, 8)}</small>
              </span>
              <Status value={t.status} />
            </button>
          )}
        </Collection>
      </section>
      <ErrorNotice error={task.error} />
      <Show when={task.error ? undefined : task.data}>
        {(t) => (
          <section class="panel detail">
            <div class="section-heading">
              <h2>Задание #{t().id.slice(0, 8)}</h2>
              <Status value={t().status} />
            </div>
            <p>
              Исполнитель:{' '}
              {t().assigneeId === s.user()?.user.id
                ? 'вы'
                : t().assigneeId
                  ? 'другой сотрудник'
                  : 'ещё не назначен'}
            </p>
            <Show when={t().status === 'ready' || t().status === 'shortage'}>
              <button
                disabled={w.busy()}
                onClick={() => {
                  w.send(
                    'Начало сборки',
                    '/api/v1/picking-tasks/{taskId}/start',
                    {},
                    { taskId: t().id },
                  ).catch(w.setError);
                }}
              >
                {t().status === 'shortage' ? 'Возобновить сборку' : 'Принять задание'}
              </button>
            </Show>
            <For each={t().lines}>
              {(line) => (
                <article class="line-card">
                  <strong>
                    {productFor(line.allocationId)
                      ? w.productLabel(productFor(line.allocationId)!)
                      : `Партия #${line.allocationId.slice(0, 8)}`}
                  </strong>
                  <p>
                    Запланировано: {line.planned} · собрано: {line.pickedTotal} · осталось:{' '}
                    {line.remaining} · отменено: {line.cancelledUnpicked}
                  </p>
                  <Show
                    when={
                      t().status === 'in_progress' &&
                      t().assigneeId === s.user()?.user.id &&
                      line.remaining > 0
                    }
                  >
                    <form
                      onSubmit={(e) => {
                        confirm(e, line.id).catch(w.setError);
                      }}
                    >
                      <div class="form-row">
                        <Field label="Фактически собрано сейчас" id={`picked-${line.id}`}>
                          <input
                            id={`picked-${line.id}`}
                            name="quantity"
                            type="number"
                            min="0"
                            max={line.remaining}
                            step="1"
                            value={line.remaining}
                            required
                          />
                        </Field>
                        <Field label="Ячейка отгрузки" id={`staged-${line.id}`}>
                          <select id={`staged-${line.id}`} name="target">
                            <option value="">Выберите отгрузку</option>
                            <For each={w.locations().filter((l) => l.kind === 'shipping')}>
                              {(l) => <option value={l.id}>{l.code}</option>}
                            </For>
                          </select>
                        </Field>
                      </div>
                      <label class="check">
                        <input type="checkbox" name="shortage" />
                        Обнаружена нехватка; остаток задания остаётся в резерве
                      </label>
                      <button disabled={w.busy()}>Зафиксировать сборку</button>
                    </form>
                  </Show>
                </article>
              )}
            </For>
          </section>
        )}
      </Show>
    </>
  );
}
