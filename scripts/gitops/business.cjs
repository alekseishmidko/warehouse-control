/** @file WMS-604: реальная HTTP бизнес-демонстрация с production auth/ACL/CSRF и synthetic fixture owners. */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { until } = require('./session.cjs');
const fetchCode = `let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>262144)throw Error('Request too large');}const q=JSON.parse(raw);const r=await fetch('http://warehouse-api:3000'+q.path,{method:q.method,headers:q.headers,body:q.body===undefined?undefined:JSON.stringify(q.body),signal:AbortSignal.timeout(15000)});console.log(JSON.stringify({status:r.status,body:await r.text(),cookies:r.headers.getSetCookie()}));`;
/** Plain fixture Pod доступен только оператору disposable cluster; owner Secret не передаётся runtime приложению. */
function helperPod(name, image, env = []) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name },
    spec: {
      restartPolicy: 'Never',
      automountServiceAccountToken: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: 'helper',
          image,
          imagePullPolicy: 'Never',
          command: ['node', '-e', 'setInterval(()=>{},1000)'],
          env,
          securityContext: {
            readOnlyRootFilesystem: true,
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
          },
          resources: {
            requests: { cpu: '50m', memory: '128Mi' },
            limits: { cpu: '1', memory: '512Mi' },
          },
          volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
        },
      ],
      volumes: [{ name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '16Mi' } }],
    },
  };
}
/** Создаёт только справочники через владельцев и первого admin через opt-in CLI; затем удаляет owner Pod. */
function seedBusiness(state) {
  const { session, values } = state;
  const password = 'Synthetic-' + randomBytes(24).toString('hex');
  const image = values.image.repository + '@' + values.image.digest;
  const env = [
    {
      name: 'DATABASE_URL',
      valueFrom: { secretKeyRef: { name: values.database.migrationSecret, key: 'DATABASE_URL' } },
    },
    { name: 'NODE_ENV', value: 'development' },
    { name: 'IDENTITY_BOOTSTRAP_ENABLED', value: 'true' },
    { name: 'AUTH_ORIGIN', value: values.auth.origin },
    { name: 'AUTH_SESSION_ABSOLUTE_SECONDS', value: values.auth.absoluteSeconds },
    { name: 'AUTH_SESSION_IDLE_SECONDS', value: values.auth.idleSeconds },
  ];
  session.apply(helperPod('gitops-fixture', image, env));
  try {
    session.k(['wait', '--for=condition=Ready', 'pod/gitops-fixture', '--timeout=120s']);
    const fixture = JSON.parse(
      session.k([
        'exec',
        'gitops-fixture',
        '--',
        'node',
        'dist/infrastructure/database/seed-dev.js',
      ]),
    );
    session.k(
      ['exec', '-i', 'gitops-fixture', '--', 'node', 'dist/modules/identity/bootstrap.js'],
      JSON.stringify({ login: 'rehearsal.admin', password }),
    );
    for (const value of Object.values(fixture)) assert.match(value, /^[a-f0-9-]{36}$/);
    return { fixture, password };
  } finally {
    session.k(['delete', 'pod/gitops-fixture', '--wait=true']);
  }
}
/** Внутрикластерный HTTP client сохраняет cookie/key только в памяти, не в argv/logs/evidence. */
function createBusinessDriver(state) {
  const { session, values } = state;
  const { fixture, password } = seedBusiness(state);
  session.apply(
    helperPod('gitops-client', values.web.image.repository + '@' + values.web.image.digest),
  );
  session.k(['wait', '--for=condition=Ready', 'pod/gitops-client', '--timeout=120s']);
  const raw = (packet) =>
    JSON.parse(
      session.k(
        ['exec', '-i', 'gitops-client', '--', 'node', '--input-type=module', '-e', fetchCode],
        JSON.stringify(packet),
      ),
    );
  const headers = { Origin: values.auth.origin, 'Content-Type': 'application/json' };
  const signed = raw({
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: { ...headers, 'X-CSRF-Protection': '1' },
    body: { login: 'rehearsal.admin', password },
  });
  assert.equal(signed.status, 200, 'Production login');
  const cookie = signed.cookies[0];
  assert.ok(
    typeof cookie === 'string' && cookie.startsWith('__Host-wms_session='),
    'Host session cookie required',
  );
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'])
    assert.ok(cookie.includes(flag), 'Cookie security flag required');
  assert.ok(!/Domain=/i.test(cookie), 'Host-only cookie required');
  const profile = JSON.parse(signed.body);
  const auth = { ...headers, Cookie: cookie.split(';')[0], 'X-CSRF-Token': profile.csrfToken };
  function request(route, method = 'GET', body, key) {
    const result = raw({
      path: '/api/v1/' + route,
      method,
      body,
      headers: { ...auth, ...(key ? { 'Idempotency-Key': key } : {}) },
    });
    return { status: result.status, body: result.body ? JSON.parse(result.body) : undefined };
  }
  function command(route, body = {}, expected = 200, key = randomUUID()) {
    const result = request(route, 'POST', body, key);
    assert.equal(result.status, expected, 'Command ' + route);
    return result.body;
  }
  command(
    'identity/users/' + profile.user.id + '/warehouses/' + fixture.warehouseId + '/roles',
    { roles: ['warehouse_supervisor'] },
    201,
  );
  return { fixture, auth, request, command, raw, session };
}
/** Receive10 → putaway10 → reserve/pick/ship3. Только HTTP owners меняют stock/allocations. */
async function demonstrateWarehouse(driver) {
  const { fixture: f, command, request, session } = driver;
  const createBody = {
    warehouseId: f.warehouseId,
    receivingLocationId: f.receivingLocationId,
    lines: [{ productId: f.productId, quantity: 10 }],
  };
  const receipt = command('receipts', createBody, 201);
  const postKey = randomUUID();
  const posted = command('receipts/' + receipt.id + '/post', {}, 200, postKey);
  assert.match(receipt.id, /^[a-f0-9-]{36}$/);
  const taskId = await until(
    () => session.sql(`select id from putaway_tasks where source_receipt_id='${receipt.id}'`),
    (id) => /^[a-f0-9-]{36}$/.test(id),
  );
  command('putaway-tasks/' + taskId + '/execute', { targetLocationId: f.storageLocationId });
  const order = command(
    'orders',
    { warehouseId: f.warehouseId, lines: [{ productId: f.productId, quantity: 3 }] },
    201,
  );
  command('orders/' + order.id + '/confirm');
  command('orders/' + order.id + '/reserve', {
    lines: [{ lineId: order.lines[0].id, quantity: 3 }],
  });
  const picking = command('orders/' + order.id + '/picking-tasks', {}, 201);
  command('picking-tasks/' + picking.id + '/start');
  command('picking-tasks/' + picking.id + '/confirm', {
    taskLineId: picking.lines[0].id,
    actualQuantity: 3,
    shortage: false,
    targetLocationId: f.shippingLocationId,
  });
  const current = request('orders/' + order.id).body;
  const allocation = current.lines[0].allocations.find(
    (a) => a.locationKind === 'shipping' && a.active === 3,
  );
  assert.ok(allocation, 'Shipping allocation must be produced by picking');
  const shipment = command(
    'orders/' + order.id + '/shipments',
    { reasonCode: 'customer-order', lines: [{ allocationId: allocation.id, quantity: 3 }] },
    201,
  );
  command('shipments/' + shipment.id + '/post');
  assert.equal(session.sql('select coalesce(sum(on_hand),0) from stock_balances'), '7');
  assert.equal(session.sql('select coalesce(sum(reserved),0) from stock_balances'), '0');
  assert.equal(request('orders/' + order.id).body.status, 'completed');
  return {
    receiptId: receipt.id,
    orderId: order.id,
    shipmentId: shipment.id,
    postKey,
    posted,
    proof: {
      received: 10,
      shipped: 3,
      onHand: 7,
      reserved: 0,
      productionAuth: true,
      warehouseAcl: true,
    },
  };
}
module.exports = { helperPod, createBusinessDriver, demonstrateWarehouse };
