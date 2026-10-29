/** @file WMS-104 PostgreSQL: catalog/warehouse constraints, receipt atomicity, absent-key race, overflow и immutable movement. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { useDatabaseSuite } from '../support/database-harness';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { transactionClient } from '@backend/infrastructure/database/postgres-transaction-runner';
import { MAX_STOCK_QUANTITY } from '@backend/shared/quantities/quantity';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import { InventoryService } from '@backend/modules/inventory/services/inventory.service';
import { products } from '@backend/modules/catalog/catalog.schema';
import { locations } from '@backend/modules/warehouses/warehouses.schema';
import { stockBalances, stockMovements } from '@backend/modules/inventory/inventory.schema';
import { auditEntries } from '@backend/modules/audit/audit.schema';
import type { ReceiveStockDto } from '@backend/modules/inventory/dto/stock.dto';

const database = useDatabaseSuite();
let runner: TransactionRunner;
let catalog: CatalogService;
let warehouses: WarehousesService;
let inventory: InventoryService;
beforeAll(async () => {
  const app = await database().createHttpApplication();
  runner = app.get(TRANSACTION_RUNNER);
  catalog = app.get(CatalogService);
  warehouses = app.get(WarehousesService);
  inventory = app.get(InventoryService);
});

/** Reuse production dev fixture builder; не повторяет правила создания справочников. */
async function fixtures() {
  return runner.run((context) => createDevWarehouseFixtures(context, catalog, warehouses));
}
/** Строит только входные синтетические данные, не начисляет их напрямую через SQL. */
function receipt(
  fixture: Awaited<ReturnType<typeof fixtures>>,
  overrides: Partial<ReceiveStockDto> = {},
): ReceiveStockDto {
  return {
    ...fixture.metadata,
    warehouseId: fixture.warehouse.id,
    locationId: fixture.receiving.id,
    productId: fixture.product.id,
    quantity: 10,
    operationId: randomUUID(),
    ...overrides,
  };
}

test('fixtures create product and three zone locations with audit but no stock', async () => {
  const fixture = await fixtures();
  expect(fixture.product.unit).toBe('piece');
  const { db } = database().connection;
  expect(await db.select().from(locations)).toHaveLength(3);
  expect(await db.select().from(auditEntries)).toHaveLength(5);
  expect(await db.select().from(stockBalances)).toEqual([]);
  expect(await db.select().from(stockMovements)).toEqual([]);
});

test('runtime receipt commits balance, immutable movement and audit together', async () => {
  const fixture = await fixtures();
  const input = receipt(fixture);
  const result = await runner.run(async (context) => {
    await transactionClient(context).execute(sql`set local role warehouse_app`);
    return inventory.receive(context, input);
  });
  expect(result.balance).toMatchObject({ onHand: 10, reserved: 0, productId: input.productId });
  const { db } = database().connection;
  expect(await db.select().from(stockMovements)).toEqual([
    expect.objectContaining({
      operationId: input.operationId,
      auditId: result.auditId,
      quantity: 10,
    }),
  ]);
  expect(await db.select().from(auditEntries)).toHaveLength(6);
  expect(await runner.run((context) => inventory.getBalance(context, input))).toEqual(
    result.balance,
  );
});

test('concurrent creation of an absent balance accumulates both receipts without lost updates', async () => {
  const fixture = await fixtures();
  const first = receipt(fixture, { quantity: 2 });
  const second = receipt(fixture, { quantity: 3 });
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const credit = (input: ReceiveStockDto) =>
    runner
      .run(async (ctx) => {
        expect(await inventory.getBalance(ctx, input)).toBeNull();
        if (++arrivals === 2) release();
        await barrier;
        return inventory.receive(ctx, input);
      })
      .catch((error) => {
        release();
        throw error;
      });
  await Promise.all([credit(first), credit(second)]);
  const { db } = database().connection;
  expect(await db.select().from(stockBalances)).toEqual([
    expect.objectContaining({ onHand: 5, reserved: 0 }),
  ]);
  expect(await db.select().from(stockMovements)).toHaveLength(2);
  expect(await db.select().from(auditEntries)).toHaveLength(7);
});

test('receipt failure after movement and audit rolls back all new rows', async () => {
  const fixture = await fixtures();
  await expect(
    runner.run(async (context) => {
      await inventory.receive(context, receipt(fixture));
      throw new Error('planned failure');
    }),
  ).rejects.toThrow('planned failure');
  const { db } = database().connection;
  expect(await db.select().from(stockBalances)).toEqual([]);
  expect(await db.select().from(stockMovements)).toEqual([]);
  expect(await db.select().from(auditEntries)).toHaveLength(5);
});

test('repeated operationId rejects without retaining a second credit or audit', async () => {
  const fixture = await fixtures();
  const input = receipt(fixture);
  await runner.run((context) => inventory.receive(context, input));
  await expect(runner.run((context) => inventory.receive(context, input))).rejects.toThrow();
  expect(await database().connection.db.select().from(stockBalances)).toEqual([
    expect.objectContaining({ onHand: 10 }),
  ]);
  expect(await database().connection.db.select().from(stockMovements)).toHaveLength(1);
  expect(await database().connection.db.select().from(auditEntries)).toHaveLength(6);
});

test.each([0, -1, 0.5, MAX_STOCK_QUANTITY + 1, NaN, '10'])(
  'invalid quantity %j leaves no effects',
  async (quantity) => {
    const fixture = await fixtures();
    await expect(
      runner.run((ctx) =>
        inventory.receive(ctx, receipt(fixture, { quantity: quantity as number })),
      ),
    ).rejects.toThrow('Invalid quantity');
    expect(await database().connection.db.select().from(stockBalances)).toEqual([]);
    expect(await database().connection.db.select().from(stockMovements)).toEqual([]);
    expect(await database().connection.db.select().from(auditEntries)).toHaveLength(5);
  },
);

test.each([
  'wrong-warehouse',
  'missing-location',
  'storage',
  'shipping',
  'missing-product',
  'invalid-audit',
])('invalid reference %s rolls back receipt', async (scenario) => {
  const fixture = await fixtures();
  const input = receipt(
    fixture,
    scenario === 'wrong-warehouse'
      ? { warehouseId: randomUUID() }
      : scenario === 'missing-location'
        ? { locationId: randomUUID() }
        : scenario === 'storage'
          ? { locationId: fixture.storage.id }
          : scenario === 'shipping'
            ? { locationId: fixture.shipping.id }
            : scenario === 'missing-product'
              ? { productId: randomUUID() }
              : { actorId: 'invalid' },
  );
  await expect(runner.run((ctx) => inventory.receive(ctx, input))).rejects.toThrow();
  expect(await database().connection.db.select().from(stockBalances)).toEqual([]);
  expect(await database().connection.db.select().from(stockMovements)).toEqual([]);
  expect(await database().connection.db.select().from(auditEntries)).toHaveLength(5);
});

test('maximum quantity succeeds, additional receipt is rejected before integer overflow', async () => {
  const fixture = await fixtures();
  await runner.run((ctx) =>
    inventory.receive(ctx, receipt(fixture, { quantity: MAX_STOCK_QUANTITY })),
  );
  await expect(
    runner.run((ctx) => inventory.receive(ctx, receipt(fixture, { quantity: 1 }))),
  ).rejects.toThrow('Stock quantity limit exceeded');
  expect(await database().connection.db.select().from(stockBalances)).toEqual([
    expect.objectContaining({ onHand: MAX_STOCK_QUANTITY }),
  ]);
  expect(await database().connection.db.select().from(stockMovements)).toHaveLength(1);
});

test('concurrent overflow permits only one safe credit', async () => {
  const fixture = await fixtures();
  const quantities = [MAX_STOCK_QUANTITY, 1];
  const results = await Promise.allSettled(
    quantities.map((quantity) =>
      runner.run((ctx) => inventory.receive(ctx, receipt(fixture, { quantity }))),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await database().connection.db.select().from(stockBalances)).toEqual([
    expect.objectContaining({
      onHand: quantities[results.findIndex((result) => result.status === 'fulfilled')],
      reserved: 0,
    }),
  ]);
  expect(await database().connection.db.select().from(stockMovements)).toHaveLength(1);
});

test('case-normalized SKU and location code uniqueness do not leave partial audit', async () => {
  const fixture = await fixtures();
  await expect(
    runner.run((ctx) =>
      catalog.create(ctx, {
        ...fixture.metadata,
        sku: fixture.product.sku.toLowerCase(),
        name: 'Duplicate',
      }),
    ),
  ).rejects.toThrow();
  await expect(
    runner.run((ctx) =>
      warehouses.createLocation(ctx, {
        ...fixture.metadata,
        warehouseId: fixture.warehouse.id,
        code: 'receiving',
        kind: 'receiving',
      }),
    ),
  ).rejects.toThrow();
  expect(await database().connection.db.select().from(products)).toHaveLength(1);
  expect(await database().connection.db.select().from(locations)).toHaveLength(3);
  expect(await database().connection.db.select().from(auditEntries)).toHaveLength(5);
});

test('composite FK rejects a valid location under a different warehouse even through raw SQL', async () => {
  const fixture = await fixtures();
  const another = await runner.run((ctx) =>
    warehouses.createWarehouse(ctx, { ...fixture.metadata, code: 'ANOTHER', name: 'Another' }),
  );
  await expect(
    database().connection.pool.query(
      'insert into stock_balances (warehouse_id, location_id, product_id) values ($1,$2,$3)',
      [another.id, fixture.receiving.id, fixture.product.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});

test.each(['negative', 'reserved-too-large', 'duplicate', 'fraction'])(
  'SQL constraints reject %s balance',
  async (scenario) => {
    const fixture = await fixtures();
    await runner.run((ctx) => inventory.receive(ctx, receipt(fixture)));
    const { pool } = database().connection;
    if (scenario === 'duplicate') {
      await expect(
        pool.query(
          'insert into stock_balances (warehouse_id,location_id,product_id) values ($1,$2,$3)',
          [fixture.warehouse.id, fixture.receiving.id, fixture.product.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    } else {
      const statement =
        scenario === 'negative'
          ? 'update stock_balances set on_hand=-1'
          : scenario === 'reserved-too-large'
            ? 'update stock_balances set reserved=11'
            : 'update stock_balances set on_hand=$1';
      await expect(
        pool.query(statement, scenario === 'fraction' ? ['1.5'] : undefined),
      ).rejects.toMatchObject({ code: scenario === 'fraction' ? '22P02' : '23514' });
    }
  },
);

test.each(['update', 'delete', 'truncate'])(
  'movement %s is forbidden both to runtime and ordinary owner SQL',
  async (operation) => {
    const fixture = await fixtures();
    await runner.run((ctx) => inventory.receive(ctx, receipt(fixture)));
    const statement =
      operation === 'update'
        ? 'update stock_movements set quantity=99'
        : operation === 'delete'
          ? 'delete from stock_movements'
          : 'truncate stock_movements';
    await expect(database().connection.pool.query(statement)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runner.run(async (ctx) => {
        await transactionClient(ctx).execute(sql`set local role warehouse_app`);
        await transactionClient(ctx).execute(sql.raw(statement));
      }),
    ).rejects.toThrow();
    expect(await database().connection.db.select().from(stockMovements)).toHaveLength(1);
  },
);

test('dev CLI builds two independent demo sets without touching stock and closes its pools', async () => {
  for (let run = 0; run < 2; run++) {
    const result = execFileSync(
      process.execPath,
      [resolve('dist/infrastructure/database/seed-dev.js')],
      {
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: database().config.databaseUrl,
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    expect(JSON.parse(result).receivingLocationId).toMatch(/^[a-f0-9-]{36}$/);
  }
  expect(await database().connection.db.select().from(products)).toHaveLength(2);
  expect(await database().connection.db.select().from(locations)).toHaveLength(6);
  expect(await database().connection.db.select().from(stockBalances)).toEqual([]);
  expect(await database().connection.db.select().from(auditEntries)).toHaveLength(10);
});
