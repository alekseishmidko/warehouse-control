/** @file Явный local Registry publish/check из Git; не включает producer и не отправляет события. */
const assert = require('node:assert/strict');
const { check } = require('./check.cjs');
const { registryClient } = require('./client.cjs');
async function main() {
  const mode = process.argv[2];
  assert.ok(
    ['publish', 'check'].includes(mode) && process.argv.length === 3,
    'usage: publish.cjs publish|check',
  );
  if (mode === 'publish')
    assert.ok(
      process.env.WMS_SCHEMA_BASE,
      'publish requires explicit WMS_SCHEMA_BASE (last accepted commit; HEAD only for fresh dev bootstrap)',
    );
  const contracts = await check({ base: process.env.WMS_SCHEMA_BASE ?? 'HEAD' });
  const client = registryClient(process.env.WMS_REGISTRY_URL ?? 'http://127.0.0.1:18081');
  for (const c of contracts) {
    if (mode === 'publish') await client.publish(c);
    else await client.verify(c);
  }
  console.log(
    'PASS Registry ' +
      mode +
      ': ' +
      contracts.length +
      ' Git artifacts, exact content and compatibility',
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
