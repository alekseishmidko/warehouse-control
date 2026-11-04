/** @file Явный reserve vector: оператор выбирает строки и частичные количества, API проверяет available атомарно. */
import { For } from 'solid-js';
import { useWorkspace } from '../data/workspace';
import { Field } from './ui';
import type { Schema } from '../api/client';
/** Не выбирает ячейки на клиенте и не уменьшает stock: это ответственность inventory. */
export function ReserveForm(props: { order: Schema['OrderDto'] }) {
  const w = useWorkspace();
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await w.send(
      'Резервирование заказа',
      '/api/v1/orders/{orderId}/reserve',
      {
        lines: props.order.lines
          .filter((l) => l.open > 0 && data.has(`selected-${l.id}`))
          .map((l) => ({ lineId: l.id, quantity: Number(data.get(`reserve-${l.id}`)) })),
      },
      { orderId: props.order.id },
    );
  };
  return (
    <form
      class="subpanel"
      onSubmit={(event) => {
        submit(event).catch(w.setError);
      }}
    >
      <h3>Зарезервировать товар</h3>
      <p class="muted">
        Выберите количество каждой строки. Нехватка одной строки откатит весь запрос.
      </p>
      <For each={props.order.lines.filter((l) => l.open > 0)}>
        {(line) => (
          <div class="form-row">
            <label class="check">
              <input name={`selected-${line.id}`} type="checkbox" checked />
              {w.productLabel(line.productId)}
            </label>
            <Field
              label={`Количество резерва для ${w.productLabel(line.productId)}`}
              id={`reserve-${line.id}`}
            >
              <input
                id={`reserve-${line.id}`}
                name={`reserve-${line.id}`}
                type="number"
                min="1"
                max={line.open}
                step="1"
                value={line.open}
                required
              />
            </Field>
          </div>
        )}
      </For>
      <button disabled={w.busy()}>Зарезервировать выбранное количество</button>
    </form>
  );
}
