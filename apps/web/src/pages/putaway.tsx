/** @file Полное выполнение putaway: target выбирает оператор, source/quantity определяет task на сервере. */
import { createSignal, For, Show } from 'solid-js';
import { useWarehouseList } from '../data/queries';
import { useWorkspace } from '../data/workspace';
import { Collection } from '../components/collection';
import { Field, Status } from '../components/ui';
/** Список обновляется вручную после worker; отсутствие task не интерпретируется как ошибка приёмки. */
export function PutawayPage() {
  const workspace = useWorkspace();
  const [status, setStatus] = createSignal('');
  const list = useWarehouseList('putaway-tasks', workspace.warehouse, (): Record<string, string> =>
    status() ? { status: status() } : {},
  );
  const execute = async (event: SubmitEvent, id: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await workspace.send(
      'Размещение товара',
      '/api/v1/putaway-tasks/{taskId}/execute',
      { targetLocationId: String(data.get('target')) },
      { taskId: id },
    );
  };
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">ВНУТРЕННИЙ ПОТОК</p>
          <h1>Размещение</h1>
          <p class="muted">
            Задания создаёт worker. Подтверждайте фактически выполненный перенос целиком.
          </p>
        </div>
        <button class="secondary" onClick={workspace.refresh}>
          Обновить задания
        </button>
      </div>
      <section class="panel">
        <Field label="Состояние задания" id="putaway-status">
          <select
            id="putaway-status"
            value={status()}
            onChange={(e) => setStatus(e.currentTarget.value)}
          >
            <option value="">Все состояния</option>
            <option value="pending">Ожидает размещения</option>
            <option value="completed">Завершён</option>
          </select>
        </Field>
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
          {(task) => (
            <article class="task-card">
              <div class="section-heading">
                <h2>
                  {workspace.productLabel(task.productId)} · {task.quantity} шт.
                </h2>
                <Status value={task.status} />
              </div>
              <p class="muted">
                Приёмка #{task.sourceReceiptId.slice(0, 8)} · задание #{task.id.slice(0, 8)}
              </p>
              <Show when={task.status === 'pending'}>
                <form
                  class="inline-form"
                  onSubmit={(e) => {
                    execute(e, task.id).catch(workspace.setError);
                  }}
                >
                  <Field
                    label={`Ячейка хранения для ${workspace.productLabel(task.productId)}`}
                    id={`putaway-${task.id}`}
                  >
                    <select id={`putaway-${task.id}`} name="target" required>
                      <option value="">Выберите хранение</option>
                      <For each={workspace.locations().filter((l) => l.kind === 'storage')}>
                        {(l) => <option value={l.id}>{l.code}</option>}
                      </For>
                    </select>
                  </Field>
                  <button disabled={workspace.busy()}>Подтвердить размещение</button>
                </form>
              </Show>
            </article>
          )}
        </Collection>
      </section>
    </>
  );
}
