/** @file AC-208-02/07: доступные формы и состояния, безопасный вывод, очистка приватного Query cache. */
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { Field } from '../src/components/ui';
import { Login } from '../src/components/login';
import { Collection } from '../src/components/collection';
import { ApiError } from '../src/api/client';
import { clearPrivateCache } from '../src/session/session';
it('login uses associated labels and erases password after rejection', async () => {
  const login = vi.fn(async () => {
    throw new ApiError(401, 'UNAUTHORIZED');
  });
  render(() => <Login onLogin={login} />);
  fireEvent.input(screen.getByLabelText('Логин'), { target: { value: 'operator' } });
  fireEvent.input(screen.getByLabelText('Пароль'), { target: { value: 'synthetic-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Войти' }).closest('form')!);
  await waitFor(() => expect(login).toHaveBeenCalledWith('operator', 'synthetic-password'));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Пароль') as HTMLInputElement).value).toBe('');
});
it('collection shows loading, empty, failure and explicit next page action', () => {
  const more = vi.fn();
  const { unmount } = render(() => (
    <Collection items={[]} loading={true} error={null} more={false} fetching={false} onMore={more}>
      {(item) => <span>{String(item)}</span>}
    </Collection>
  ));
  expect(screen.getByRole('status').textContent).toContain('Загрузка');
  unmount();
  const empty = render(() => (
    <Collection items={[]} loading={false} error={null} more={false} fetching={false} onMore={more}>
      {(item) => <span>{String(item)}</span>}
    </Collection>
  ));
  expect(screen.getByText('Пока нет записей')).toBeTruthy();
  empty.unmount();
  const failure = render(() => (
    <Collection
      items={[]}
      loading={false}
      error={new ApiError(403, 'FORBIDDEN')}
      more={false}
      fetching={false}
      onMore={more}
    >
      {(item) => <span>{String(item)}</span>}
    </Collection>
  ));
  expect(screen.getByRole('alert').textContent).toContain('нет права');
  failure.unmount();
  render(() => (
    <Collection
      items={['строка']}
      loading={false}
      error={null}
      more={true}
      fetching={false}
      onMore={more}
    >
      {(item) => <span>{item}</span>}
    </Collection>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
  expect(more).toHaveBeenCalledOnce();
});
it('logout/401 cache cleanup removes data of previous user', () => {
  const queries = new QueryClient();
  queries.setQueryData(['private', 'user-a', 'warehouse-a'], { onHand: 10 });
  clearPrivateCache(queries);
  expect(queries.getQueryCache().getAll()).toHaveLength(0);
});

it('select accessible name does not include option text', () => {
  render(() => (
    <Field label="Ячейка" id="test-cell">
      <select id="test-cell">
        <option>Выберите</option>
        <option>STORAGE</option>
      </select>
    </Field>
  ));
  expect(screen.getByRole('combobox', { name: 'Ячейка' })).toBeTruthy();
});
