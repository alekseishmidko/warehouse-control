/** @file AC-208 gate 2: настоящий Chromium → Vite proxy → Nest session/ACL → PostgreSQL, с потерей ответа после commit. */
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { useDatabaseSuite } from '../support/database-harness';
import { identityFixture } from '../support/identity.fixture';
import { hashPassword } from '@backend/shared/security/password';
import { createDevWarehouseFixtures } from '@backend/infrastructure/database/dev-fixtures';
import { CatalogService } from '@backend/modules/catalog/services/catalog.service';
import { WarehousesService } from '@backend/modules/warehouses/services/warehouses.service';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '@backend/shared/transactions/transaction.port';
import { WorkerService } from '@backend/infrastructure/worker/services/worker.service';
const db = useDatabaseSuite();
let app: INestApplication,
  worker: INestApplicationContext,
  browser: Browser,
  vite: ChildProcess | undefined,
  origin: string;
/** OS выдаёт ephemeral port. Vite strictPort не вправе незаметно сменить Origin CSRF. */
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
beforeAll(async () => {
  const port = await unusedPort();
  origin = `http://127.0.0.1:${port}`;
  app = await db().createHttpApplication({ origin });
  await app.listen(0, '127.0.0.1');
  worker = await db().createWorkerApplication();
  const serverAddress = app.getHttpServer().address() as { port: number };
  vite = spawn(
    process.execPath,
    [
      resolve('../web/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: resolve('../web'),
      env: { ...process.env, WEB_API_TARGET: `http://127.0.0.1:${serverAddress.port}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let startupError = '';
  vite.stderr?.on('data', (chunk) => {
    startupError = (startupError + String(chunk)).slice(-2000);
  });
  // Это bounded readiness poll процесса, не ожидание гонки бизнес-операций.
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${startupError}`);
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Процесс ещё поднимает listener. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error('Web server readiness timeout');
  browser = await chromium.launch({ headless: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  if (vite && vite.exitCode === null) {
    const stopped = new Promise<void>((resolve) => vite!.once('exit', () => resolve()));
    vite.kill('SIGTERM');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        stopped,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            vite?.kill('SIGKILL');
            reject(new Error('Vite cleanup timeout'));
          }, 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}, 15000);
/** HTTP response приходит из того же browser, который отправил UI action; прямых бизнес POST из test runner нет. */
async function clickCommand(
  page: Page,
  label: string,
  path: string,
): Promise<Record<string, unknown>> {
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
  );
  await page.getByRole('button', { name: label, exact: true }).click();
  const result = await response;
  expect(result.status()).toBeGreaterThanOrEqual(200);
  expect(result.status()).toBeLessThan(300);
  return (await result.json()) as Record<string, unknown>;
}
/** Формы и меню управляются через accessible labels, как у оператора с клавиатурой. */
async function login(page: Page, userId: string, password: string) {
  await page.goto(origin);
  await page.getByLabel('Логин', { exact: true }).fill(`test-${userId}`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await browserExpect(
    page.getByRole('heading', { name: 'Выберите склад', exact: true }),
  ).toBeVisible();
}
async function open(page: Page, path: string) {
  await page.getByRole('link', { name: path, exact: true }).click();
}

test('AC-208-01..08: complete browser path, same-key recovery, partial operations, ACL and ledger reconciliation', async () => {
  const runner = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  const fixture = await runner.run((c) =>
    createDevWarehouseFixtures(c, app.get(CatalogService), app.get(WarehousesService)),
  );
  const foreign = await runner.run((c) =>
    createDevWarehouseFixtures(c, app.get(CatalogService), app.get(WarehousesService)),
  );
  // Синтетические credentials существуют только в disposable БД. Hash вычислен тем же production security helper.
  const password = 'Synthetic-gate2-password-42!';
  const hash = await hashPassword(password);
  const operator = await identityFixture(app, {
    warehouseId: fixture.warehouse.id,
    role: 'warehouse_supervisor',
    passwordHash: hash,
  });
  const viewer = await identityFixture(app, {
    warehouseId: fixture.warehouse.id,
    role: 'viewer',
    passwordHash: hash,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (req) =>
    console.info(
      'Gate request failed',
      req.method(),
      new URL(req.url()).pathname,
      req.failure()?.errorText,
    ),
  );
  try {
    await login(page, operator.userId, password);
    expect(await page.locator('#warehouse-select option').allTextContents()).not.toContain(
      foreign.warehouse.name + ' · ' + foreign.warehouse.code,
    );
    await page.getByLabel('Текущий склад', { exact: true }).selectOption(fixture.warehouse.id);
    await open(page, 'Приёмка');
    await page.getByLabel('Ячейка приёмки', { exact: true }).selectOption(fixture.receiving.id);
    await page.getByLabel('Товар 1', { exact: true }).selectOption(fixture.product.id);
    await page.getByLabel('Количество 1', { exact: true }).fill('10');
    let firstKey = '';
    let firstBody = '';
    let receiptRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/receipts')
        receiptRequests++;
    });
    let releaseResponse!: () => void;
    const responseBarrier = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    // Route.fetch доводит запрос до commit. Barrier удерживает ответ, пока браузер делает
    // настоящий двойной клик: второй клик не вправе создать ещё один HTTP запрос/key.
    // Затем теряется только ответ. finally снимает barrier даже при ошибке assertions.
    await page.route(
      '**/api/v1/receipts',
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        firstKey = route.request().headers()['idempotency-key'];
        firstBody = route.request().postData() ?? '';
        await route.fetch();
        await responseBarrier;
        await route.abort('failed');
      },
      { times: 1 },
    );
    try {
      const create = page.getByRole('button', { name: 'Создать черновик', exact: true });
      await create.dblclick();
      await browserExpect(create).toBeDisabled();
      await browserExpect
        .poll(async () =>
          Number(
            (await db().connection.pool.query('select count(*)::int n from receipts')).rows[0].n,
          ),
        )
        .toBe(1);
      expect(receiptRequests).toBe(1);
    } finally {
      releaseResponse();
    }
    await browserExpect(
      page.getByRole('button', { name: 'Проверить результат с прежним ключом', exact: true }),
    ).toBeEnabled();
    expect(
      (await db().connection.pool.query('select count(*)::int n from receipts')).rows[0].n,
    ).toBe(1);
    await page.reload();
    await page.getByLabel('Текущий склад', { exact: true }).selectOption(fixture.warehouse.id);
    const replay = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/receipts',
    );
    await page
      .getByRole('button', { name: 'Проверить результат с прежним ключом', exact: true })
      .click();
    const repeated = await replay;
    expect(repeated.headers()['idempotency-key']).toBe(firstKey);
    expect(repeated.postData()).toBe(firstBody);
    await browserExpect(
      page.getByRole('button', { name: 'Проверить результат с прежним ключом', exact: true }),
    ).toHaveCount(0);
    await open(page, 'Приёмка');
    // Успешный replay после reload не разрешает создать второй draft прежней формой с новым key.
    await browserExpect(
      page.getByRole('button', { name: 'Создать черновик', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: /Приёмка #/ })
      .first()
      .click();
    const receiptId = (await db().connection.pool.query('select id from receipts')).rows[0]
      .id as string;
    await clickCommand(page, 'Провести приёмку', `/api/v1/receipts/${receiptId}/post`);
    await open(page, 'Размещение');
    await browserExpect(page.getByText('Пока нет записей', { exact: true })).toBeVisible();
    const [claim] = await worker.get(WorkerService).claim();
    expect(await worker.get(WorkerService).process(claim)).toBe('completed');
    await page.getByRole('button', { name: 'Обновить задания', exact: true }).click();
    await page
      .getByLabel(`Ячейка хранения для ${fixture.product.sku}`, { exact: true })
      .selectOption(fixture.storage.id);
    const taskId = (await db().connection.pool.query('select id from putaway_tasks')).rows[0]
      .id as string;
    await clickCommand(page, 'Подтвердить размещение', `/api/v1/putaway-tasks/${taskId}/execute`);
    /** Повторяемый UI сценарий заказа: все amounts вводятся оператором, тест не реализует reserve/pick SQL. */
    async function createAndPick(quantity: number, picked: number) {
      await open(page, 'Заказы');
      await page.getByLabel('Товар 1', { exact: true }).selectOption(fixture.product.id);
      await page.getByLabel('Количество 1', { exact: true }).fill(String(quantity));
      const created = await clickCommand(page, 'Создать черновик', '/api/v1/orders');
      const id = String(created.id);
      await clickCommand(page, 'Подтвердить заказ', `/api/v1/orders/${id}/confirm`);
      await clickCommand(
        page,
        'Зарезервировать выбранное количество',
        `/api/v1/orders/${id}/reserve`,
      );
      const task = await clickCommand(
        page,
        'Создать задание сборки',
        `/api/v1/orders/${id}/picking-tasks`,
      );
      await open(page, 'Сборка');
      await page
        .getByRole('button', { name: new RegExp(`Сборка #${String(task.id).slice(0, 8)}`) })
        .click();
      await clickCommand(page, 'Принять задание', `/api/v1/picking-tasks/${task.id}/start`);
      await page.getByLabel('Фактически собрано сейчас', { exact: true }).fill(String(picked));
      await page.getByLabel('Ячейка отгрузки', { exact: true }).selectOption(fixture.shipping.id);
      if (picked < quantity)
        await page
          .getByLabel('Обнаружена нехватка; остаток задания остаётся в резерве', { exact: true })
          .check();
      await clickCommand(page, 'Зафиксировать сборку', `/api/v1/picking-tasks/${task.id}/confirm`);
      return id;
    }
    async function prepareAndShip(id: string, quantity: number) {
      await open(page, 'Заказы');
      await page.getByRole('button', { name: new RegExp(`Заказ #${id.slice(0, 8)}`) }).click();
      await page.getByLabel('Количество к отгрузке', { exact: true }).fill(String(quantity));
      const shipment = await clickCommand(
        page,
        'Создать отгрузку',
        `/api/v1/orders/${id}/shipments`,
      );
      expect((shipment.lines as Array<{ quantity: number }>).map((line) => line.quantity)).toEqual([
        quantity,
      ]);
      await open(page, 'Отгрузка');
      await page
        .getByRole('button', { name: new RegExp(`Отгрузка #${String(shipment.id).slice(0, 8)}`) })
        .click();
      await clickCommand(page, 'Подтвердить отгрузку', `/api/v1/shipments/${shipment.id}/post`);
    }
    const order = await createAndPick(3, 3);
    // Отмена draft shipment не отменяет заказ и не меняет подготовленный резерв.
    await open(page, 'Заказы');
    await page.getByRole('button', { name: new RegExp(`Заказ #${order.slice(0, 8)}`) }).click();
    await page.getByLabel('Количество к отгрузке', { exact: true }).fill('1');
    const cancelledShipment = await clickCommand(
      page,
      'Создать отгрузку',
      `/api/v1/orders/${order}/shipments`,
    );
    await open(page, 'Отгрузка');
    await page
      .getByRole('button', {
        name: new RegExp(`Отгрузка #${String(cancelledShipment.id).slice(0, 8)}`),
      })
      .click();
    await clickCommand(
      page,
      'Отменить черновик отгрузки',
      `/api/v1/shipments/${cancelledShipment.id}/cancel`,
    );
    await prepareAndShip(order, 3);
    await open(page, 'Обзор остатков');
    await browserExpect(
      page.getByRole('row', { name: new RegExp(`${fixture.product.sku} STORAGE Хранение 7 0 7`) }),
    ).toBeVisible();
    const firstState = (
      await db().connection.pool.query(
        'select sum(on_hand)::int on_hand,sum(reserved)::int reserved from stock_balances',
      )
    ).rows[0];
    expect(firstState).toEqual({ on_hand: 7, reserved: 0 });
    const outputs = resolve('../web/test-results');
    await mkdir(outputs, { recursive: true });
    await page.screenshot({ path: resolve(outputs, 'gate2-stock.png'), fullPage: true });
    const partial = await createAndPick(4, 2);
    await prepareAndShip(partial, 1);
    await open(page, 'Заказы');
    await page.getByRole('button', { name: new RegExp(`Заказ #${partial.slice(0, 8)}`) }).click();
    await clickCommand(page, 'Отменить заказ', `/api/v1/orders/${partial}/cancel`);
    await page
      .getByLabel('Ячейка возврата в хранение', { exact: true })
      .selectOption(fixture.storage.id);
    await page.getByLabel('Весь неотгруженный товар физически возвращён', { exact: true }).check();
    await clickCommand(
      page,
      'Подтвердить полный возврат',
      `/api/v1/orders/${partial}/cancellation-return`,
    );
    await browserExpect(page.getByText('Закрыт частично', { exact: true })).toHaveCount(2);
    await open(page, 'История');
    await browserExpect(
      page.locator('.history-row').getByText(new RegExp(fixture.product.sku)).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Аудит', exact: true }).click();
    await browserExpect(
      page.getByText('fulfillment.shipment-posted', { exact: true }).first(),
    ).toBeVisible();
    const ledger = await db().connection.pool.query(
      'select b.id from stock_balances b left join stock_allocations a on a.balance_id=b.id group by b.id having b.reserved<>coalesce(sum(a.active),0)',
    );
    expect(ledger.rows).toEqual([]);
    expect(
      (
        await db().connection.pool.query(
          'select sum(on_hand)::int q,sum(reserved)::int r from stock_balances',
        )
      ).rows[0],
    ).toEqual({ q: 6, r: 0 });
    expect(
      (
        await db().connection.pool.query(
          "select sum(case when kind in ('receipt','transfer-in') then quantity else -quantity end)::int q from stock_movements",
        )
      ).rows[0].q,
    ).toBe(6);
    expect(
      (await db().connection.pool.query('select status from orders where id=$1', [partial])).rows[0]
        .status,
    ).toBe('closed_mixed');
    // Отдельный partial reserve/release до picking: UI отправляет явное количество, а не скрытый all-or-nothing на весь заказ.
    await open(page, 'Заказы');
    await page.getByLabel('Товар 1', { exact: true }).selectOption(fixture.product.id);
    await page.getByLabel('Количество 1', { exact: true }).fill('2');
    const releasedOrder = await clickCommand(page, 'Создать черновик', '/api/v1/orders');
    const releasedId = String(releasedOrder.id);
    await clickCommand(page, 'Подтвердить заказ', `/api/v1/orders/${releasedId}/confirm`);
    await page
      .getByLabel(`Количество резерва для ${fixture.product.sku}`, { exact: true })
      .fill('1');
    await clickCommand(
      page,
      'Зарезервировать выбранное количество',
      `/api/v1/orders/${releasedId}/reserve`,
    );
    const allocation = (
      await db().connection.pool.query(
        'select a.id from stock_allocations a join order_lines l on l.id=a.line_id where l.order_id=$1 and a.active=1',
        [releasedId],
      )
    ).rows[0].id as string;
    await clickCommand(
      page,
      'Освободить резерв',
      `/api/v1/orders/${releasedId}/allocations/${allocation}/release`,
    );
    await clickCommand(page, 'Отменить заказ', `/api/v1/orders/${releasedId}/cancel`);
    expect(
      (await db().connection.pool.query('select sum(reserved)::int r from stock_balances')).rows[0]
        .r,
    ).toBe(0);
    await page.goto(origin);
    await browserExpect(page.getByLabel('Текущий склад', { exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await browserExpect(
      page.getByRole('link', { name: 'Перейти к содержимому', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await browserExpect(page.locator('#main-content')).toBeFocused();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await browserExpect(page.getByLabel('Логин', { exact: true })).toBeVisible();
    await login(page, viewer.userId, password);
    await page.getByLabel('Текущий склад', { exact: true }).selectOption(fixture.warehouse.id);
    await open(page, 'Приёмка');
    await page.getByLabel('Ячейка приёмки', { exact: true }).selectOption(fixture.receiving.id);
    await page.getByLabel('Товар 1', { exact: true }).selectOption(fixture.product.id);
    await page.getByRole('button', { name: 'Создать черновик', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toContainText('нет права');
    expect(
      (await db().connection.pool.query('select count(*)::int n from receipts')).rows[0].n,
    ).toBe(1);
    expect(pageErrors).toEqual([]);
  } catch (error) {
    await mkdir(resolve('../web/test-results'), { recursive: true });
    await page.screenshot({
      path: resolve('../web/test-results/gate2-failure.png'),
      fullPage: true,
    });
    console.info('Gate UI failure', await page.locator('body').innerText(), pageErrors);
    throw error;
  } finally {
    await context.close();
  }
}, 180000);
