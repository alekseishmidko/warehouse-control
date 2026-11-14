/** @file WMS-502: Git schemas/topology и консервативная проверка совместимости; без HTTP/DB. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
// Топология принадлежит aggregate stream, поэтому два event types заказа не расходятся.
const routes = {
  receipt: { topic: 'warehouse.receiving.events', consumers: ['inventory.putaway'] },
  'putaway-task': { topic: 'warehouse.inventory.putaway.events', consumers: [] },
  order: { topic: 'warehouse.fulfillment.order.events', consumers: [] },
  'picking-task': { topic: 'warehouse.fulfillment.picking.events', consumers: [] },
};
/** Канонизация нужна для equality/diff, не меняет schema keywords или dialect. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
/** Идентификатор revision content-addressed, не aggregateVersion/schemaVersion envelope. */
function revision(schema) {
  return createHash('sha256').update(canonical(schema)).digest('hex');
}
/** Читает только доверенные paths Git; каждый schema/type должен иметь явный topic. */
function loadContracts() {
  const directory = path.join(root, 'docs/contracts/events');
  const contracts = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.schema.json'))
    .sort()
    .map((filename) => {
      const schema = JSON.parse(fs.readFileSync(path.join(directory, filename)));
      assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
      const type = schema.properties.type.const;
      const version = schema.properties.schemaVersion.const;
      assert.ok(typeof type === 'string' && Number.isSafeInteger(version) && version > 0);
      const name = type + '.v' + version;
      assert.equal(filename, name + '.schema.json', 'filename/type/version mismatch');
      const aggregateType = schema.properties.aggregateType.const;
      assert.ok(Object.hasOwn(routes, aggregateType), 'new aggregate requires explicit topology');
      const route = routes[aggregateType];
      return {
        name,
        type,
        version,
        ...route,
        schema,
        example: JSON.parse(
          fs.readFileSync(path.join(root, 'docs/contracts/examples', name + '.json')),
        ),
      };
    });
  const topics = new Map();
  for (const c of contracts) {
    const aggregate = c.schema.properties.aggregateType.const;
    assert.ok(
      !topics.has(aggregate) || topics.get(aggregate) === c.topic,
      'aggregate stream cannot split by event type',
    );
    topics.set(aggregate, c.topic);
  }
  return contracts;
}
/** Evaluation annotations/refs могут изменить смысл нового properties даже без type.
 * Для них общего доказательства здесь нет: evolution fail closed, включая вложенные schemas.
 * Консервативный обход может отклонить совпадающее имя в annotation/example — это safe false positive.
 */
function assertSupportedEvolution(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(
      ![
        'unevaluatedProperties',
        'unevaluatedItems',
        '$ref',
        '$dynamicRef',
        '$recursiveRef',
      ].includes(key),
      'unsupported schema evolution keyword ' + key,
    );
    assertSupportedEvolution(child);
  }
}
/** Достаточное условие FULL совместимости для текущего open-content поднабора.
 * Не пытается доказать произвольную JSON Schema subsumption. Старые ограничения
 * заморожены; новые optional properties разрешены только без ограничений, если
 * раньше additionalProperties=true. Иначе fail closed и новый major/отдельное review.
 */
function assertCompatible(previous, next, location = '$') {
  if (canonical(previous) === canonical(next)) return;
  assert.ok(
    previous &&
      next &&
      typeof previous === 'object' &&
      typeof next === 'object' &&
      !Array.isArray(previous) &&
      !Array.isArray(next),
    `breaking schema at ${location}`,
  );
  assertSupportedEvolution(previous);
  assertSupportedEvolution(next);
  const annotation = new Set(['description', 'title', '$comment', 'examples']);
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (annotation.has(key)) continue;
    if (key === 'properties') {
      const oldProps = previous.properties ?? {},
        newProps = next.properties ?? {};
      for (const name of Object.keys(oldProps)) {
        assert.ok(Object.hasOwn(newProps, name), `removed property ${location}.${name}`);
        assertCompatible(oldProps[name], newProps[name], location + '.' + name);
      }
      for (const name of Object.keys(newProps).filter((n) => !Object.hasOwn(oldProps, n))) {
        assert.ok(
          !(next.required ?? []).includes(name),
          `new required property ${location}.${name}`,
        );
        assert.ok(
          previous.additionalProperties === undefined || previous.additionalProperties === true,
          `unsupported extension ${location}.${name}`,
        );
        const extension = newProps[name];
        assert.ok(
          extension === true ||
            (extension &&
              typeof extension === 'object' &&
              !Array.isArray(extension) &&
              Object.keys(extension).every((k) => annotation.has(k))),
          `typed extension narrows previously open property ${location}.${name}`,
        );
      }
    } else
      assert.equal(
        canonical(previous[key]),
        canonical(next[key]),
        `changed constraint ${location}.${key}`,
      );
  }
}
/** AsyncAPI описывает plain UTF-8 JSON value, без Confluent magic byte/schema-ID prefix. */
function asyncApiDocument(contracts = loadContracts()) {
  const messages = {},
    channels = {};
  for (const c of contracts) {
    messages[c.name] = {
      name: c.name,
      title: c.type,
      contentType: 'application/json',
      schemaFormat: 'application/schema+json;version=draft-2020-12',
      correlationId: { location: '$message.payload#/correlationId' },
      payload: c.schema,
      headers: {
        type: 'object',
        properties: {
          'content-type': { type: 'string', const: 'application/json' },
          'x-event-type': { type: 'string', const: c.type },
          'x-schema-version': { type: 'string', const: String(c.version) },
        },
      },
      'x-registry-artifact': c.name,
      'x-logical-consumers': c.consumers,
    };
    channels[c.topic] ??= {
      description:
        'Все версии одного aggregateId используют один topic/key. Новые topics кроме receipt требуют provisioning перед WMS-503.',
      bindings: { kafka: { bindingVersion: '0.5.0' } },
      publish: { operationId: 'publish_' + c.topic.replaceAll('.', '_'), message: { oneOf: [] } },
    };
    channels[c.topic].publish.message.oneOf.push({ $ref: '#/components/messages/' + c.name });
    messages[c.name].bindings = {
      kafka: {
        key: { type: 'string', format: 'uuid', pattern: '^[0-9a-f-]{36}$' },
        bindingVersion: '0.5.0',
      },
    };
  }
  channels['warehouse.receiving.events'].subscribe = {
    operationId: 'inventory_putaway',
    bindings: {
      kafka: { groupId: { type: 'string', const: 'inventory.putaway' }, bindingVersion: '0.5.0' },
    },
    message: { $ref: '#/components/messages/receiving.receipt-posted.v1' },
    description:
      'Validate envelope до effect; DB effect/marker/cursor atomic; Kafka offset после commit. Реализация WMS-504, до cutover работает DB worker.',
  };
  return {
    asyncapi: '2.6.0',
    id: 'urn:warehouse:kafka',
    info: {
      title: 'Warehouse Kafka contracts',
      version: '1.0.0',
      description:
        'WMS-502 contracts; Kafka producer/consumer runtime подключается последующими этапами.',
      license: { name: 'UNLICENSED' },
    },
    defaultContentType: 'application/json',
    servers: {
      dev: {
        url: 'warehouse-kafka-bootstrap.warehouse-kafka.svc:9093',
        protocol: 'kafka-secure',
        security: [{ mtls: [] }],
        description: 'Strimzi dev internal mTLS; RF1 не HA',
      },
    },
    channels,
    components: { securitySchemes: { mtls: { type: 'X509' } }, messages },
  };
}
module.exports = { loadContracts, canonical, revision, assertCompatible, asyncApiDocument, root };
