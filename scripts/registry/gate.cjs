/** @file WMS-502 live spike: Git publish/read-back, Registry rules и consumer Ajv на реальном dev Registry. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { profile } = require('./profile.cjs');
const { registryClient } = require('./client.cjs');
const { loadContracts, assertCompatible, canonical, revision, root } = require('./contracts.cjs');
const { createEventAjv, check } = require('./check.cjs');
/** Вызывает именно публичный root entry point; loopback URL и UUID project остаются test-owned. */
function command(name, url) {
  execFileSync('pnpm', [name], {
    cwd: root,
    env: {
      ...process.env,
      WMS_REGISTRY_URL: url,
      // Bootstrap собственного пустого dev Registry — единственный случай HEAD baseline.
      WMS_SCHEMA_BASE:
        process.env.WMS_SCHEMA_BASE ??
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    },
    stdio: 'inherit',
    timeout: 120000,
  });
}
async function main() {
  process.env.WMS_REGISTRY_PORT = '0';
  const project = 'wms-registry-' + randomUUID();
  const stand = profile(project);
  try {
    const base = await stand.up();
    console.log('PASS Registry HTTP ready');
    command('registry:publish', base);
    command('registry:check', base);
    command('registry:publish', base);
    const contracts = await check(),
      client = registryClient(base);
    const {
      EventContracts,
    } = require('../../apps/backend/dist/shared/events/services/event-contracts');
    const consumer = new EventContracts();
    for (const c of contracts) {
      const remote = await client.request(
        'GET',
        client.artifactPath(c.name) + '/versions/' + revision(c.schema) + '/content',
      );
      assert.equal(canonical(remote.data), canonical(c.schema));
      assert.ok(createEventAjv().compile(remote.data)(c.example));
      assert.equal(consumer.parseForHandler(JSON.stringify(c.example)).type, c.type);
    }
    // Проверяем именно используемую conditional semantics, formats и отсутствие coercion.
    const shipping = contracts.find((c) => c.type === 'fulfillment.shipping-changed');
    const missingShipment = structuredClone(shipping.example);
    missingShipment.payload.action = 'shipment-posted';
    delete missingShipment.payload.shipmentId;
    assert.equal(createEventAjv().compile(shipping.schema)(missingShipment), false);
    assert.throws(
      () => consumer.parseForHandler(JSON.stringify(missingShipment)),
      (e) => e.code === 'INVALID_EVENT',
    );
    const receipt = contracts.find((c) => c.type === 'receiving.receipt-posted');
    for (const mutate of [
      (e) => (e.payload.lines[0].quantity = '1'),
      (e) => (e.eventId = 'not-a-uuid'),
      (e) => (e.occurredAt = '2026-02-30T00:00:00.000Z'),
    ]) {
      const invalid = structuredClone(receipt.example);
      mutate(invalid);
      assert.equal(createEventAjv().compile(receipt.schema)(invalid), false);
      assert.throws(
        () => consumer.parseForHandler(JSON.stringify(invalid)),
        (e) => e.code === 'INVALID_EVENT',
      );
    }
    // Воспроизводимый dialect spike на отдельном test-owned artifact. Native
    // rule должен отвергнуть даже annotation change как unsupported dialect;
    // каталог приложения и business data не меняются этим probe.
    const probe = { ...receipt, name: 'dialect-probe-' + randomUUID() };
    await client.publish(probe);
    const validityProbe = { ...receipt, name: 'validity-probe-' + randomUUID() };
    await client.publish(validityProbe);
    const malformed = structuredClone(receipt.schema);
    malformed.properties.eventId.type = 'not-a-type';
    const acceptedMalformed = await client.request(
      'POST',
      client.artifactPath(validityProbe.name) + '/versions',
      {
        version: 'invalid-schema-probe',
        content: { content: JSON.stringify(malformed), contentType: 'application/json' },
      },
      [200, 201],
    );
    assert.ok(acceptedMalformed.status < 300);
    await assert.rejects(client.publish({ ...validityProbe, schema: malformed }));
    const probePath = client.artifactPath(probe.name);
    await client.request(
      'PUT',
      probePath + '/rules/COMPATIBILITY',
      { config: 'FULL_TRANSITIVE' },
      [200, 204],
    );
    const annotation = { ...receipt.schema, description: 'Dialect compatibility probe' };
    // Изолированный raw writer показывает пределы server rule: INVALID schema
    // принимается каталогом, поэтому production boundary — наш preflight, не REST.
    const native = await client.request(
      'POST',
      probePath + '/versions',
      {
        version: 'annotation-probe',
        content: { content: JSON.stringify(annotation), contentType: 'application/json' },
      },
      [422],
    );
    assert.equal(native.data.name, 'UnprocessableSchemaException');
    // Probe artifact остаётся только в disposable Registry; finally удаляет весь test project.
    // API deletion по умолчанию запрещена, ради теста её не включаем.
    console.log(
      'PASS native 2020-12 compatibility limitation reproduced (HTTP422); catalog storage supported; strict validity is local',
    );
    // Annotation-only revisions совместимы в обе стороны. Поэтому этот probe
    // достигает именно latest equality, а не более раннего structural guard.
    const latestProbe = { ...receipt, name: 'latest-probe-' + randomUUID() };
    await client.publish(latestProbe);
    const annotated = {
      ...latestProbe,
      schema: { ...receipt.schema, description: 'New annotation revision' },
    };
    await client.publish(annotated);
    await assert.rejects(client.verify(latestProbe), /Registry latest differs from Git/);
    await client.request(
      'PUT',
      client.artifactPath(latestProbe.name) + '/rules/COMPATIBILITY',
      { config: 'FULL_TRANSITIVE' },
      [200, 204],
    );
    await assert.rejects(client.verify(annotated), /Registry rule drift COMPATIBILITY/);
    const additive = structuredClone(receipt.schema);
    additive.properties.operatorNote = { description: 'Необязательное unconstrained extension' };
    assertCompatible(receipt.schema, additive);
    const next = { ...receipt, schema: additive };
    await assert.rejects(client.verify(next), 'unpublished candidate must fail check');
    await client.publish(next);
    await client.verify(next);
    const extended = { ...receipt.example, operatorNote: 'synthetic extension' };
    assert.ok(createEventAjv().compile(additive)(extended));
    assert.equal(
      consumer.parseForHandler(JSON.stringify(extended)).operatorNote,
      extended.operatorNote,
    );
    const unknown = { ...receipt.example, schemaVersion: 999 };
    assert.throws(
      () => consumer.parseForHandler(JSON.stringify(unknown)),
      (error) => error.code === 'UNSUPPORTED_EVENT',
    );
    assert.equal(createEventAjv().compile(receipt.schema)(unknown), false);
    const broken = structuredClone(additive);
    broken.properties.aggregateVersion = { type: 'string' };
    assert.throws(() => assertCompatible(additive, broken));
    // Проверяем end-to-end release boundary: несовместимый schema не должен
    // попасть в Registry даже при ограничении native compatibility server.
    const versionsPath = client.artifactPath(receipt.name) + '/versions?limit=1000';
    const before = (await client.request('GET', versionsPath)).data.count;
    const brokenExample = {
      ...receipt.example,
      aggregateVersion: String(receipt.example.aggregateVersion),
    };
    assert.ok(createEventAjv().compile(broken)(brokenExample));
    await assert.rejects(client.publish({ ...receipt, schema: broken, example: brokenExample }));
    assert.equal(
      (await client.request('GET', versionsPath)).data.count,
      before,
      'breaking candidate must not be published',
    );
    console.log(
      'PASS 2020-12 Registry/Ajv; additive accepted, breaking blocked before POST, unknown version refused',
    );
    // Новая revision в Registry при прежнем Git должна заблокировать release check.
    assert.throws(() => command('registry:check', base));
    console.log('PASS exact Git/Registry drift blocks release; no producer enabled');
  } finally {
    stand.down();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
