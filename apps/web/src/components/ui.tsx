/** @file Общие доступные компоненты UI: семантический HTML, safe messages и состояния загрузки. */
import { For, Show, type JSX, type ParentProps } from 'solid-js';
import { problemMessage } from '../api/problems';
/** Явная label/input связь нужна для клавиатуры, screen reader и browser tests. */
export function Field(props: ParentProps<{ label: string; id: string }>) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      {props.children}
    </div>
  );
}
/** Показывает только безопасное сообщение: transport code преобразуется одним mapper, raw payload не выводится. */
export function ErrorNotice(props: { error: unknown }) {
  return (
    <Show when={props.error}>
      <p class="notice error" role="alert">
        {problemMessage(props.error)}
      </p>
    </Show>
  );
}
/** Статус переводится отдельно от машинного контракта; цвет не единственный носитель смысла. */
export function Status(props: { value: string }) {
  const labels: Record<string, string> = {
    draft: 'Черновик',
    posted: 'Проведён',
    pending: 'Ожидает размещения',
    completed: 'Завершён',
    active: 'Активен',
    ready: 'К сборке',
    in_progress: 'В работе',
    shortage: 'Нехватка',
    cancel_pending: 'Ожидает возврата',
    cancelled: 'Отменён',
    closed_mixed: 'Закрыт частично',
  };
  return <span class={`badge ${props.value}`}>{labels[props.value] ?? props.value}</span>;
}
/** Неактивное состояние делает повторный клик недоступным, серверная идемпотентность остаётся обязательной. */
export function ActionButton(
  props: ParentProps<{ onClick: () => void; disabled?: boolean; secondary?: boolean }>,
) {
  return (
    <button
      type="button"
      class={props.secondary ? 'secondary' : ''}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}
/** Таблица сохраняет заголовки колонок и пустое состояние вместо пустого визуального блока. */
export function DataTable(props: { headers: string[]; empty: boolean; children: JSX.Element }) {
  return (
    <Show when={!props.empty} fallback={<p class="empty">Пока нет записей</p>}>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <For each={props.headers}>{(title) => <th scope="col">{title}</th>}</For>
            </tr>
          </thead>
          <tbody>{props.children}</tbody>
        </table>
      </div>
    </Show>
  );
}
