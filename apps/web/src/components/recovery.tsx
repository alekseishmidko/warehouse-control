/** @file Видимый recovery сохранённой команды: только явный повтор с прежним ключом; можно восстановить после reload. */
import { createMemo, createSignal, Show } from 'solid-js';
import { useSession } from '../session/session';
import { ErrorNotice } from './ui';
/** Уведомляет workspace после успеха для invalidation read models; journal не меняет body из текущей формы. */
export function Recovery(props: {
  onRecovered: () => void;
  disabled: boolean;
  warehouseId: string;
}) {
  const session = useSession();
  const [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal<unknown>();
  const pending = createMemo(() => {
    session.journalVersion();
    const user = session.user();
    return user ? session.journal.read(user.user.id) : null;
  });
  const retry = async () => {
    const user = session.user();
    if (!user || busy()) return;
    setBusy(true);
    setError(undefined);
    try {
      await session.journal.send(user.user.id, user.csrfToken);
      props.onRecovered();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show when={pending()}>
      {(p) => (
        <section class="notice warning" aria-label="Сохранённая команда">
          <strong>Нужно проверить результат: {p().label}</strong>
          <p>
            Ответ мог потеряться после выполнения. Сохранён исходный запрос. Повтор использует тот
            же ключ. Если исходная команда ещё не выполнилась, повтор выполнит её сейчас.
          </p>
          <p>Склад команды: {p().warehouseId}</p>
          <Show when={p().warehouseId !== props.warehouseId}>
            <p>Для проверки выберите исходный склад команды.</p>
          </Show>
          <code>{p().key}</code>
          <button
            type="button"
            disabled={busy() || props.disabled || p().warehouseId !== props.warehouseId}
            onClick={() => {
              retry().catch(setError);
            }}
          >
            Проверить результат с прежним ключом
          </button>
          <ErrorNotice error={error()} />
        </section>
      )}
    </Show>
  );
}
