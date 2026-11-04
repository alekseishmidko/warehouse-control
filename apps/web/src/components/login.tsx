/** @file Login форма: пароль живёт только в поле до завершения запроса и не входит в command journal. */
import { createSignal } from 'solid-js';
import { Field, ErrorNotice } from './ui';
/** Callback обслуживает настоящую auth session либо изолированный test transport. */
export function Login(props: { onLogin: (login: string, password: string) => Promise<void> }) {
  const [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal<unknown>();
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy()) return;
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    setBusy(true);
    setError(undefined);
    try {
      await props.onLogin(String(data.get('login')), String(data.get('password')));
    } catch (e) {
      setError(e);
    } finally {
      form.reset();
      setBusy(false);
    }
  };
  return (
    <main class="login-page">
      <section class="login-card">
        <div class="brand-mark">W</div>
        <p class="eyebrow">WAREHOUSE CONTROLLER</p>
        <h1>Вход в рабочее пространство</h1>
        <p class="muted">Управляйте складом и отслеживайте каждую операцию.</p>
        <form
          onSubmit={(event) => {
            submit(event).catch(setError);
          }}
        >
          <Field label="Логин" id="login">
            <input id="login" name="login" autocomplete="username" required minlength={3} />
          </Field>
          <Field label="Пароль" id="password">
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </Field>
          <ErrorNotice error={error()} />
          <button disabled={busy()}>{busy() ? 'Входим…' : 'Войти'}</button>
        </form>
        <p class="muted small">Доступ определяется вашей ролью на выбранном складе.</p>
      </section>
    </main>
  );
}
