/** @file Solid Query: ключ включает subject/warehouse/resource/filters; signal отменяет устаревший read. */
import { createInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { useSession } from '../session/session';
import type { ResourceMap } from '../api/client';
/** Один cache на ресурс/склад/субъект; cursor точно соответствует выбранным filters. */
export function useWarehouseList<R extends keyof ResourceMap>(
  resource: R,
  warehouse: Accessor<string>,
  filters: Accessor<Record<string, string>> = () => ({}),
  active: Accessor<boolean> = () => true,
) {
  const session = useSession();
  return createInfiniteQuery(() => ({
    queryKey: ['private', session.user()?.user.id, warehouse(), resource, filters()],
    enabled: !!session.user() && !!warehouse() && active(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.api.list(
        resource,
        warehouse(),
        { limit: '100', ...filters(), ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  }));
}
