/** @file WMS-403.1: четыре разных заказа конкурируют за одну штуку; driver доказывает DB waits. */
import { actor, request, won, conflicted, optionsFor, summary } from './common.js';
export const options = optionsFor('sku');
export default function () {
  const order = actor().order;
  const { response } = request(
    `/api/v1/orders/${order.id}/reserve`,
    {
      lines: [{ lineId: order.lines[0].id, quantity: 1 }],
    },
    'order.reserve',
    [200, 409],
  );
  if (response.status === 200) won.add(1);
  else conflicted.add(1);
}
export const handleSummary = summary;
