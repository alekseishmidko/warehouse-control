/** @file Единая policy Query: no auto retry, stable Solid store reconciliation по id, без фонового refetch при фокусе. */
import { QueryClient } from '@tanstack/solid-query';
/** Reconcile сохраняет идентичность строк DTO и пользовательский ввод при перечитывании того же документа. */
export function createWarehouseQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, reconcile: 'id' },
      mutations: { retry: false },
    },
  });
}
