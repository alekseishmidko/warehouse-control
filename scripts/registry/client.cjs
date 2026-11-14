/** @file Registry REST v3 adapter: bounded loopback-only dev I/O, без credentials в logs. */
const assert = require('node:assert/strict');
const { canonical, revision, assertCompatible } = require('./contracts.cjs');
const { createEventAjv } = require('./validation.cjs');
// Native compatibility не поддерживает 2020-12 в выбранной версии Registry.
// FULL_TRANSITIVE остаётся обязательным release policy в assertCompatible/history loop.
const REGISTRY_RULES = Object.freeze([
  ['VALIDITY', 'FULL'],
  ['COMPATIBILITY', 'NONE'],
]);
/** Не принимает произвольный внешний endpoint: dev publish не даёт разрешения внешнего deployment. */
function registryClient(base) {
  const url = new URL(base);
  assert.ok(
    url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    'Registry requires local HTTP loopback',
  );
  const prefix = url.origin + '/apis/registry/v3';
  async function request(method, path, body, expected = [200]) {
    const response = await fetch(prefix + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const text = await response.text();
    assert.ok(
      expected.includes(response.status),
      `Registry ${method} ${path} status ${response.status}`,
    );
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  const artifactPath = (name) => '/groups/default/artifacts/' + encodeURIComponent(name);
  /** Check сначала сравнивает ВСЕ исторические revisions; publish не переписывает прежнюю версию. */
  async function sync(contract, publish = false) {
    // Native Registry rule не гарантирует semantic validity2020-12. Даже direct
    // publication adapter проверяет schema/fixture до первого HTTP request.
    assert.ok(
      createEventAjv().compile(contract.schema)(contract.example),
      'candidate fixture invalid',
    );
    const p = artifactPath(contract.name),
      hash = revision(contract.schema);
    const found = await request('GET', p, undefined, [200, 404]);
    if (found.status === 200)
      assert.equal(found.data.artifactType, 'JSON', 'Registry artifact type drift');
    if (found.status === 404) {
      assert.ok(publish, 'missing Registry artifact ' + contract.name);
      await request(
        'POST',
        '/groups/default/artifacts',
        { artifactId: contract.name, artifactType: 'JSON' },
        [200, 201],
      );
      for (const [ruleType, config] of REGISTRY_RULES) {
        await request('POST', p + '/rules', { ruleType, config }, [200, 201, 204]);
      }
    }
    // Spike: native compatibility Apicurio3.3.4 не распознаёт 2020-12.
    // Поэтому server хранит/проверяет validity; FULL_TRANSITIVE ниже обеспечивает
    // local guard по КАЖДОЙ сохранённой версии до POST новой revision.
    // Drifting/missing rules не восстанавливаются молча.
    for (const [rule, expected] of REGISTRY_RULES) {
      const currentRule = await request('GET', p + '/rules/' + rule);
      assert.equal(currentRule.data.config, expected, 'Registry rule drift ' + rule);
    }
    const versions = await request('GET', p + '/versions?limit=1000');
    assert.ok(versions.data.count <= 1000, 'Registry history requires explicit pagination');
    for (const v of versions.data.versions) {
      const old = await request(
        'GET',
        p + '/versions/' + encodeURIComponent(v.version) + '/content',
      );
      createEventAjv().compile(old.data); // invalid historical metadata блокирует release.
      assertCompatible(old.data, contract.schema);
    }
    const current = await request(
      'GET',
      p + '/versions/' + hash + '/content',
      undefined,
      [200, 404],
    );
    if (current.status === 404) {
      assert.ok(publish, 'Git/Registry revision drift ' + contract.name);
      await request(
        'POST',
        p + '/versions',
        {
          version: hash,
          content: { content: JSON.stringify(contract.schema), contentType: 'application/json' },
        },
        [200, 201],
      );
    }
    const latest = await request('GET', p + '/versions/branch=latest/content');
    assert.equal(
      canonical(latest.data),
      canonical(contract.schema),
      'Registry latest differs from Git',
    );
    const content = await request('GET', p + '/versions/' + hash + '/content');
    assert.equal(canonical(content.data), canonical(contract.schema), 'published content mismatch');
    return hash;
  }
  return {
    request,
    artifactPath,
    // Публичные имена явно различают read-only verify и effectful publish.
    verify: (contract) => sync(contract, false),
    publish: (contract) => sync(contract, true),
  };
}
module.exports = { registryClient };
