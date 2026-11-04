/** @file Общие loading/error/empty/cursor состояния списков, без копирования query cache. */
import { For, Show, type JSX } from 'solid-js';
import { ErrorNotice } from './ui';
/** Consumer задаёт rendering строки; только явный клик загружает следующую страницу. */
export function Collection<T>(props: {
  items: T[];
  loading: boolean;
  error: unknown;
  more: boolean;
  fetching: boolean;
  onMore: () => void;
  children: (item: T) => JSX.Element;
}) {
  return (
    <>
      <Show when={props.loading}>
        <p role="status" class="empty">
          Загрузка данных…
        </p>
      </Show>
      <ErrorNotice error={props.error} />
      <Show when={!props.loading && !props.error && props.items.length === 0}>
        <p class="empty">Пока нет записей</p>
      </Show>
      <For each={props.error ? [] : props.items}>{(item) => props.children(item)}</For>
      <Show when={props.more}>
        <button
          type="button"
          class="secondary more"
          disabled={props.fetching}
          onClick={() => props.onMore()}
        >
          Загрузить ещё
        </button>
      </Show>
    </>
  );
}
