/** @file Общая форма immutable состава документов: несколько явных строк, семантические поля, серверная validation. */
import { CONTRACT_LIMITS } from '../api/generated/schema';
import { createSignal, For, Show, untrack } from 'solid-js';
import { useWorkspace } from '../data/workspace';
import { useSession } from '../session/session';
import { Field } from './ui';
/** UI не вычисляет доступность/резервы; передаёт пользовательский вектор владельцу API. */
export function DraftForm(props: {
  kind: 'receipt' | 'order';
  onCreate: (
    lines: { productId: string; quantity: number }[],
    locationId: string,
  ) => Promise<boolean>;
}) {
  const workspace = useWorkspace();
  const session = useSession();
  /** Журнал переживает reload, локальный submitted — нет. Та же create-команда не становится новым намерением после replay. */
  const hasSavedDraftCommand = () => {
    const user = session.user();
    const pending = user ? session.journal.read(user.user.id) : null;
    return (
      pending?.warehouseId === workspace.warehouse() &&
      pending.url === (props.kind === 'receipt' ? '/api/v1/receipts' : '/api/v1/orders')
    );
  };
  const [rows, setRows] = createSignal([crypto.randomUUID()]);
  // Это начальный снимок. Исчезновение pending при успешном replay не должно автоматически разблокировать create.
  const [submitted, setSubmitted] = createSignal(untrack(hasSavedDraftCommand));
  let form!: HTMLFormElement;
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (workspace.busy() || submitted()) return;
    const form = event.currentTarget as HTMLFormElement,
      data = new FormData(form);
    const products = data.getAll('productId'),
      quantities = data.getAll('quantity');
    const success = await props.onCreate(
      products.map((p, i) => ({ productId: String(p), quantity: Number(quantities[i]) })),
      String(data.get('locationId') ?? ''),
    );
    if (success || hasSavedDraftCommand()) setSubmitted(true);
  };
  return (
    <form
      ref={form}
      class="panel"
      onSubmit={(event) => {
        submit(event).catch(workspace.setError);
      }}
    >
      <h2>{props.kind === 'receipt' ? 'Новая приёмка' : 'Новый заказ'}</h2>
      <p class="muted">Состав сохраняется как черновик. Изменить строки после создания нельзя.</p>
      <Show when={props.kind === 'receipt'}>
        <Field label="Ячейка приёмки" id="receipt-location">
          <select id="receipt-location" name="locationId" required>
            <option value="">Выберите ячейку</option>
            <For each={workspace.locations().filter((l) => l.kind === 'receiving')}>
              {(l) => <option value={l.id}>{l.code}</option>}
            </For>
          </select>
        </Field>
      </Show>
      <For each={rows()}>
        {(id, index) => (
          <div class="form-row">
            <Field label={`Товар ${index() + 1}`} id={`product-${id}`}>
              <select id={`product-${id}`} name="productId" required>
                <option value="">Выберите товар</option>
                <For each={workspace.products()}>
                  {(p) => (
                    <option value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  )}
                </For>
              </select>
            </Field>
            <Field label={`Количество ${index() + 1}`} id={`quantity-${id}`}>
              <input
                id={`quantity-${id}`}
                name="quantity"
                type="number"
                min="1"
                max={CONTRACT_LIMITS.quantityMax}
                step="1"
                value={props.kind === 'receipt' ? 10 : 3}
                required
              />
            </Field>
            <button
              type="button"
              class="ghost"
              disabled={rows().length === 1}
              aria-label={`Удалить строку ${index() + 1}`}
              onClick={() => setRows((ids) => ids.filter((v) => v !== id))}
            >
              ×
            </button>
          </div>
        )}
      </For>
      <div class="actions">
        <button
          type="button"
          class="secondary"
          disabled={
            rows().length >=
            (props.kind === 'receipt' ? CONTRACT_LIMITS.receiptLines : CONTRACT_LIMITS.orderLines)
          }
          onClick={() => setRows((ids) => [...ids, crypto.randomUUID()])}
        >
          Добавить строку
        </button>
        <button disabled={workspace.busy() || submitted()}>Создать черновик</button>
        <Show when={submitted()}>
          <button
            type="button"
            class="secondary"
            onClick={() => {
              form.reset();
              setRows([crypto.randomUUID()]);
              setSubmitted(false);
            }}
          >
            Новый черновик
          </button>
        </Show>
      </div>
    </form>
  );
}
