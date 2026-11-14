/** @file Offline regression: open-content compatibility fail-closed и AsyncAPI dialect без broker. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadContracts, assertCompatible, asyncApiDocument } = require('./contracts.cjs');
const { validateAsyncApi, createEventAjv } = require('./check.cjs');
const { registryClient } = require('./client.cjs');
test('open schema permits additive unconstrained extension, rejects narrowing/breaking and false schema', () => {
  const old = loadContracts().find((c) => c.type === 'receiving.receipt-posted').schema;
  const additive = structuredClone(old);
  additive.properties.operatorNote = { description: 'Optional extension без нового ограничения' };
  assertCompatible(old, additive);
  for (const mutate of [
    (s) => (s.properties.aggregateVersion.type = 'string'),
    (s) => s.required.push('newRequired'),
    (s) => (s.properties.newTyped = { type: 'string' }),
    (s) => (s.properties.disabled = false),
    (s) => (s.properties.payload.properties.lines.maxItems = 10),
    (s) => delete s.properties.eventId,
  ]) {
    const next = structuredClone(old);
    mutate(next);
    assert.throws(() => assertCompatible(old, next));
  }
  assertCompatible(old, { ...old, description: 'Обновлена аннотация' });
});
test('AsyncAPI references all Git types; receipt/order schemas keep one aggregate topic', async () => {
  const contracts = loadContracts();
  assert.equal(contracts.length, 5);
  await validateAsyncApi(asyncApiDocument(contracts));
  for (const c of contracts) assert.equal(createEventAjv().compile(c.schema)(c.example), true);
  const invalid = asyncApiDocument();
  delete invalid.info.title;
  await assert.rejects(validateAsyncApi(invalid));
  const brokenPayload = asyncApiDocument();
  brokenPayload.components.messages[contracts[0].name].payload = structuredClone(
    contracts[0].schema,
  );
  brokenPayload.components.messages[contracts[0].name].payload.properties.eventId.type =
    'not-a-json-type';
  await assert.rejects(validateAsyncApi(brokenPayload));
});
test('Registry endpoint cannot select remote service or credentials', () => {
  for (const url of [
    'https://example.org',
    'http://192.0.2.1',
    'http://user:secret@localhost',
    'http://localhost?a=b',
  ])
    assert.throws(() => registryClient(url));
});

test('additive proof fails closed for unevaluated/ref semantics and closed content', () => {
  for (const old of [
    { type: 'object', properties: {}, unevaluatedProperties: false },
    { type: 'object', properties: {}, $ref: '#/$defs/object' },
    { type: 'object', properties: {}, additionalProperties: false },
  ]) {
    const next = structuredClone(old);
    next.properties.extension = {};
    assert.throws(() => assertCompatible(old, next));
  }
});

test('publication adapter rejects invalid metaschema before any HTTP access', async () => {
  const invalid = structuredClone(loadContracts()[0]);
  invalid.schema.properties.eventId.type = 'not-a-type';
  // Port9 не используется сервисом: проверяем именно ошибку schema, не network rejection.
  const client = registryClient('http://127.0.0.1:9');
  for (const operation of ['verify', 'publish'])
    await assert.rejects(client[operation](invalid), /schema is invalid/);
});

test('profile rejects invalid ports and remote Docker before creating resources', () => {
  const { profile } = require('./profile.cjs');
  const oldPort = process.env.WMS_REGISTRY_PORT,
    oldHost = process.env.DOCKER_HOST;
  try {
    for (const port of ['65536', '-1', '127.0.0.1:18081']) {
      process.env.WMS_REGISTRY_PORT = port;
      assert.throws(() => profile('wms-registry-502ddddd'));
    }
    process.env.WMS_REGISTRY_PORT = '0';
    process.env.DOCKER_HOST = 'tcp://example.invalid:2375';
    assert.throws(() => profile('wms-registry-502ddddd'), /requires local Docker/);
  } finally {
    if (oldPort === undefined) delete process.env.WMS_REGISTRY_PORT;
    else process.env.WMS_REGISTRY_PORT = oldPort;
    if (oldHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = oldHost;
  }
});
