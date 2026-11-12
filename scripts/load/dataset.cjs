/** @file Dataset строится production owners: fixtures → admin/session/grants → документы → storage. */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { budget } = require('./config.cjs');
const { snapshot, waitFor } = require('./observe.cjs');

/** Docker exec adapter с JSON stdin: credentials не становятся argv и не печатаются в artifact. */
function createHttp(compose) {
  return async (path, method = 'GET', body, actor, key) => {
    const result = JSON.parse(
      await compose(
        [
          'exec',
          '-T',
          'api',
          'node',
          '-e',
          `
      (async()=>{
        const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
        const response=await fetch('http://127.0.0.1:3000'+input.path,{
          method:input.method,signal:AbortSignal.timeout(10000),
          headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000','X-CSRF-Protection':'1',
            ...(input.actor?{Cookie:input.actor.cookie,'X-CSRF-Token':input.actor.csrfToken}:{}),
            ...(input.key?{'Idempotency-Key':input.key}:{})},
          ...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
        const text=await response.text();
        console.log(JSON.stringify({status:response.status,body:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0]}));
      })().catch(()=>process.exitCode=1);`,
        ],
        20000,
        JSON.stringify({ path, method, body, actor, key }),
      ),
    );
    return result;
  };
}
/** Проверяет статус без дампа response: login body и cookie содержат capabilities. */
function expectStatus(response, expected, operation) {
  assert.equal(response.status, expected, `${operation} status`);
  return response.body;
}
/** Контрольные команды не попадают в latency k6. Их commit и handler setup завершаются до measurement. */
async function createDataset({ compose, http, pool, scenario, stopWorker }) {
  const fixtures = [];
  for (let i = 0; i < (scenario === 'sku' ? 1 : budget.vus); i++) {
    fixtures.push(
      JSON.parse(
        await compose([
          'exec',
          '-T',
          '-e',
          'NODE_ENV=development',
          'api',
          'node',
          'dist/infrastructure/database/seed-dev.js',
        ]),
      ),
    );
  }
  const password = 'Load-' + randomBytes(24).toString('hex');
  await compose(
    [
      'exec',
      '-T',
      '-e',
      'IDENTITY_BOOTSTRAP_ENABLED=true',
      'api',
      'node',
      'dist/modules/identity/bootstrap.js',
    ],
    60000,
    JSON.stringify({ login: 'load.admin', password }),
  );
  const signed = await http('/api/v1/auth/login', 'POST', { login: 'load.admin', password });
  expectStatus(signed, 200, 'admin login');
  const admin = { cookie: signed.cookie, csrfToken: signed.body.csrfToken };
  const grant = async (userId, warehouseId) =>
    expectStatus(
      await http(
        `/api/v1/identity/users/${userId}/warehouses/${warehouseId}/roles`,
        'POST',
        { roles: ['warehouse_operator', 'order_manager'] },
        admin,
      ),
      201,
      'grant',
    );
  for (const fixture of fixtures) await grant(signed.body.user.id, fixture.warehouseId);
  const actors = [];
  for (let i = 0; i < budget.vus; i++) {
    const login = `load.vu${i + 1}`;
    const user = expectStatus(
      await http('/api/v1/identity/users', 'POST', { login, password, systemAdmin: false }, admin),
      201,
      'create VU',
    );
    const fixture = fixtures[scenario === 'sku' ? 0 : i];
    await grant(user.id, fixture.warehouseId);
    const logged = await http('/api/v1/auth/login', 'POST', { login, password });
    expectStatus(logged, 200, 'VU login');
    actors.push({ cookie: logged.cookie, csrfToken: logged.body.csrfToken, fixture });
  }
  if (scenario === 'sku') {
    const fixture = fixtures[0];
    const receipt = expectStatus(
      await http(
        '/api/v1/receipts',
        'POST',
        {
          warehouseId: fixture.warehouseId,
          receivingLocationId: fixture.receivingLocationId,
          lines: [{ productId: fixture.productId, quantity: 1 }],
        },
        admin,
        randomUUID(),
      ),
      201,
      'setup receipt',
    );
    expectStatus(
      await http(`/api/v1/receipts/${receipt.id}/post`, 'POST', {}, admin, randomUUID()),
      200,
      'setup post',
    );
    await waitFor(
      () => snapshot(pool),
      (s) => s.completed === 1,
      budget.drainTimeoutMs,
      'setup delivery deadline',
    );
    const {
      rows: [task],
    } = await pool.query('SELECT id FROM putaway_tasks WHERE source_receipt_id=$1', [receipt.id]);
    expectStatus(
      await http(
        `/api/v1/putaway-tasks/${task.id}/execute`,
        'POST',
        { targetLocationId: fixture.storageLocationId },
        admin,
        randomUUID(),
      ),
      200,
      'setup putaway',
    );
    await stopWorker();
    for (const actor of actors) {
      actor.order = expectStatus(
        await http(
          '/api/v1/orders',
          'POST',
          {
            warehouseId: fixture.warehouseId,
            lines: [{ productId: fixture.productId, quantity: 1 }],
          },
          actor,
          randomUUID(),
        ),
        201,
        'setup order',
      );
      expectStatus(
        await http(`/api/v1/orders/${actor.order.id}/confirm`, 'POST', {}, actor, randomUUID()),
        200,
        'setup confirm',
      );
    }
  }
  return { actors, admin, fixtures };
}
module.exports = { createHttp, createDataset, expectStatus };
