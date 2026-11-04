/** @file Вход Solid SPA: Query → Session → Router; backend модулей в bundle нет. */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createWarehouseQueryClient } from './data/query-client';
import { SessionProvider } from './session/session';
import { App } from './pages/app';
import './styles.css';
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
const client = createWarehouseQueryClient();
render(
  () => (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Router>
          <Route path="/*" component={App} />
        </Router>
      </SessionProvider>
    </QueryClientProvider>
  ),
  root,
);
