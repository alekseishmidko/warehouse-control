/** @file Runtime DTO отгрузки/возврата: без coercion, с int4/UUID/лимитами и закрытым полем причины. */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrepareShipmentDto } from '@backend/modules/fulfillment/dto/prepare-shipment.dto';
import { CancellationReturnDto } from '@backend/modules/fulfillment/dto/cancellation-return.dto';
const uuid = '26000000-0000-4000-8000-000000000001';
/** Проверка совпадает с transport whitelist policy и не копирует бизнес-проверку доступного резерва. */
test('shipping DTO rejects invalid quantity/IDs/reason and unknown fields', async () => {
  const input = { reasonCode: 'customer-dispatch', lines: [{ allocationId: uuid, quantity: 1 }] };
  const check = (v: unknown) =>
    validate(plainToInstance(PrepareShipmentDto, v), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  expect(await check(input)).toHaveLength(0);
  for (const invalid of [
    { ...input, reasonCode: 'секретный текст' },
    { ...input, actorId: uuid },
    { ...input, lines: [] },
    { ...input, lines: [{ allocationId: 'bad', quantity: 1 }] },
    ...[0, -1, 1.2, 2147483648, '1'].map((quantity) => ({
      ...input,
      lines: [{ allocationId: uuid, quantity }],
    })),
  ])
    expect((await check(invalid)).length).toBeGreaterThan(0);
  const returned = {
    reasonCode: 'customer-cancelled',
    lines: [{ lineId: uuid, quantity: 1, targetLocationId: uuid }],
  };
  expect(await validate(plainToInstance(CancellationReturnDto, returned))).toHaveLength(0);
});
