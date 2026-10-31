/** @file Runtime границы команд WMS-204: вложенные DTO, int4 и запрет клиентского actor/status. Не тест SQL сценария. */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from '@backend/modules/fulfillment/dto/create-order.dto';
import { ReserveOrderDto } from '@backend/modules/fulfillment/dto/reserve-order.dto';
import { ReleaseAllocationDto } from '@backend/modules/fulfillment/dto/release-allocation.dto';
const id = '16000000-0000-4000-8000-000000000001';
/** Тот же whitelist policy, что HTTP pipeline; ошибки не являются успешным coercion. */
const errors = (type: new () => object, value: object) =>
  validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });
test('create order accepts int4 and rejects empty, malformed and privileged input', async () => {
  expect(
    await errors(CreateOrderDto, {
      warehouseId: id,
      lines: [{ productId: id, quantity: 2147483647 }],
    }),
  ).toHaveLength(0);
  for (const value of [
    { warehouseId: id, lines: [] },
    { warehouseId: id, lines: [{ productId: id, quantity: '10' }] },
    { warehouseId: id, lines: [{ productId: id, quantity: 2147483648 }] },
    { warehouseId: id, lines: [{ productId: id, quantity: 0 }] },
    { warehouseId: id, lines: [{ productId: 'invalid', quantity: 1 }] },
    { warehouseId: id, lines: [{ productId: id, quantity: 1 }], status: 'active' },
  ])
    expect((await errors(CreateOrderDto, value)).length).toBeGreaterThan(0);
});
test('reserve and release require explicit positive integer quantities', async () => {
  expect(await errors(ReserveOrderDto, { lines: [{ lineId: id, quantity: 6 }] })).toHaveLength(0);
  expect(await errors(ReleaseAllocationDto, { quantity: 1 })).toHaveLength(0);
  for (const quantity of [0, -1, 0.5, '1', 2147483648]) {
    expect(
      (await errors(ReserveOrderDto, { lines: [{ lineId: id, quantity }] })).length,
    ).toBeGreaterThan(0);
    expect((await errors(ReleaseAllocationDto, { quantity })).length).toBeGreaterThan(0);
  }
});
